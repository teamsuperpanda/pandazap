import { App, TFile, requestUrl } from 'obsidian';
import {
  AnkiCard,
  PandaZapSettings,
  SyncAnalysis,
  CardAction,
  CardSyncInfo,
  AnkiNoteInfo,
  AnkiCardInfo,
  AnkiConnectResponse,
  NoteCacheEntry,
  AnkiConnectionState,
  SyncCardResult,
  SyncResult,
  SyncRunOptions,
  describeConnection,
} from './types';
import {
  ANKI_CONNECT_VERSION,
  PLUGIN_TAG,
  MEDIA_FILENAME_PREFIX,
  REQUEST_TIMEOUT_MS,
  RETRY_BACKOFF_BASE_MS,
} from '../constants';
import { buildAnkiConnectUrl } from '../settings';
import { escapeRegex } from './markers';
import { stableHash } from './hashUtils';
import { withTimeout } from './requestTimeout';
import {
  resolveImageSource,
  readImageFileToBase64,
  downloadImageToBase64,
  extractMediaFilenames,
  getStoredMediaFilename,
  getStoredMediaFilenameForSource,
} from './imageUtils';

export class AnkiConnector {
  private settings: PandaZapSettings;
  private app: App;
  private noteCache: {
    deckName: string;
    byFront: Map<string, NoteCacheEntry[]>;
  } | null = null;
  private cacheKey: string;

  constructor(settings: PandaZapSettings, app: App) {
    this.settings = settings;
    this.app = app;
    this.cacheKey = cacheKeyFor(settings);
  }

  /**
   * Update settings, keeping cached notes unless the connection or deck
   * targeting changed. Callers that need a guaranteed fresh read use
   * {@link invalidateCache}.
   */
  updateSettings(newSettings: PandaZapSettings): void {
    const nextCacheKey = cacheKeyFor(newSettings);
    const cacheStillValid = nextCacheKey === this.cacheKey;
    this.settings = newSettings;
    this.cacheKey = nextCacheKey;
    if (!cacheStillValid) this.invalidateCache();
  }

  /** Drop cached notes so the next lookup re-reads Anki. */
  invalidateCache(): void {
    this.noteCache = null;
  }

  async testConnection(): Promise<AnkiConnectionState> {
    try {
      const version = await this.ankiConnectRequest('version');
      if (typeof version !== 'number') return { status: 'protocol-error' };
      if (version < ANKI_CONNECT_VERSION) return { status: 'version-too-old', version };
      return { status: 'ok', version };
    } catch (e: unknown) {
      if (isTimeoutError(e)) {
        console.warn('PandaZap: connection test timed out', e);
        return { status: 'unreachable', detail: `Timed out after ${REQUEST_TIMEOUT_MS} ms.` };
      }
      if (isNetworkError(e)) return { status: 'unreachable' };
      console.warn('PandaZap: connection test failed', e);
      return { status: 'protocol-error' };
    }
  }

  async analyzeSyncOperation(
    cards: readonly AnkiCard[],
    notePath?: string,
    noteContent?: string,
    skipConnectionTest: boolean = false
  ): Promise<SyncAnalysis> {
    const analysis: SyncAnalysis = {
      cardsToAdd: [],
      cardsToUpdate: [],
      cardsToDelete: [],
      totalCards: cards.length,
    };

    if (!skipConnectionTest) {
      const connection = await this.testConnection();
      if (connection.status !== 'ok') {
        throw new Error(describeConnection(connection, ANKI_CONNECT_VERSION));
      }
    }

    const deckName = this.getDeckName(notePath, noteContent);

    for (const card of cards) {
      const existingEntry = await this.findExistingCard(card, deckName, notePath, noteContent);

      if (existingEntry) {
        try {
          const ni = existingEntry.raw;
          const front = (ni?.fields?.Front?.value ?? '').trim();
          const back = (ni?.fields?.Back?.value ?? '').trim();
          const qTrim = (card.question || '').trim();

          let match = false;

          if (fieldsMatch(front, qTrim)) {
            if (card.image) {
              const storedFilename = notePath
                ? getStoredMediaFilename(this.app, card.image, notePath)
                : null;
              const expectedBack = storedFilename
                ? card.answer
                  ? `${card.answer}<br><img src="${storedFilename}">`
                  : `<img src="${storedFilename}">`
                : card.answer;
              match = Boolean(storedFilename) && fieldsMatch(back, expectedBack || '');
            } else {
              const aTrim = (card.answer || '').trim();
              if (fieldsMatch(back, aTrim)) {
                match = true;
              }
            }
          }

          if (match) {
            continue;
          } else {
            const cardSyncInfo: CardSyncInfo = {
              card,
              action: CardAction.UPDATE,
              deckName,
              existingCardId: existingEntry.noteId,
            };
            analysis.cardsToUpdate.push(cardSyncInfo);
          }
        } catch (e: unknown) {
          console.warn('PandaZap: failed to compare note info', e);
          throw e;
        }
      } else {
        analysis.cardsToAdd.push({ card, action: CardAction.ADD, deckName });
      }
    }

    // Deletion is scoped by the plugin tag and the note's source tag, so it
    // applies to the shared default deck as well as to note-based decks.
    if (notePath) {
      const extractedQuestions = new Set(cards.map((c) => normalizeField(c.question || '')));

      const findNotes = async (query: string): Promise<string[]> => {
        const existingNoteIds = (await this.ankiConnectRequest('findNotes', {
          query,
        })) as string[];
        if (!Array.isArray(existingNoteIds)) throw new Error('Anki returned invalid note IDs');
        return existingNoteIds;
      };

      const sourceTags =
        cards.length === 0
          ? [this.getSourceTag(notePath)]
          : this.getEligibleSourceTags(notePath, deckName, noteContent);
      const noteIds = new Set<string>();
      for (const sourceTag of sourceTags) {
        // An emptied note may have lost its `Deck::` line or had the default deck
        // changed, so a deck filter would hide the notes it still owns. Its exact
        // source tag is unique per note and safe to match across decks; the
        // legacy tag can be shared, so it stays out of this path.
        const query =
          cards.length === 0
            ? `tag:${PLUGIN_TAG} tag:${sourceTag}`
            : `deck:"${deckName}" tag:${PLUGIN_TAG} tag:${sourceTag}`;
        for (const noteId of await findNotes(query)) noteIds.add(noteId);
      }

      if (noteIds.size > 0) {
        const notesInfo = (await this.ankiConnectRequest('notesInfo', {
          notes: [...noteIds],
        })) as AnkiNoteInfo[];
        if (!Array.isArray(notesInfo)) throw new Error('Anki returned invalid note information');

        for (const ni of notesInfo) {
          try {
            if (!ni.tags?.some((tag) => sourceTags.includes(tag))) continue;
            const front = ni.fields?.Front?.value?.trim() ?? '';
            const back = ni.fields?.Back?.value?.trim() ?? '';
            if (front && !extractedQuestions.has(normalizeField(front))) {
              const delCard = { question: front, answer: back, line: -1 };
              const noteId = ni.noteId ?? ni.noteIds?.[0] ?? ni.id ?? '';
              analysis.cardsToDelete.push({
                card: delCard,
                action: CardAction.DELETE,
                deckName,
                existingCardId: noteId,
              });
            }
          } catch (e: unknown) {
            console.warn('PandaZap: error processing note for deletion', e);
          }
        }
      }
    }

    return analysis;
  }

  private async findExistingCard(
    card: AnkiCard,
    deckName: string,
    notePath?: string,
    noteContent?: string
  ): Promise<NoteCacheEntry | null> {
    await this.prefetchNotesForDeck(deckName);
    return this.selectCacheEntry(card, notePath, deckName, noteContent) ?? null;
  }

  async syncCards(
    cards: readonly AnkiCard[],
    preview: boolean = false,
    notePath?: string,
    noteContent?: string,
    deleteConfirmed: boolean = false,
    confirmedDeletionIds?: readonly string[],
    skipConnectionTest: boolean = false,
    runOptions?: SyncRunOptions
  ): Promise<SyncResult> {
    if (!skipConnectionTest) {
      const connection = await this.testConnection();
      if (connection.status !== 'ok') {
        throw new Error(describeConnection(connection, ANKI_CONNECT_VERSION));
      }
    }

    const results: SyncCardResult[] = [];
    const deckName = this.getDeckName(notePath, noteContent);
    const totalCards = cards.length;
    let processedCards = 0;
    runOptions?.onProgress?.(processedCards, totalCards);

    const isCancelled = () => runOptions?.abort?.cancelled === true;

    if (this.settings.useNoteBased && notePath && !preview && cards.length > 0 && !isCancelled()) {
      try {
        await this.ankiConnectRequest('createDeck', {
          deck: deckName,
        });
      } catch (e: unknown) {
        console.warn('PandaZap: deck creation error', e);
      }
    }

    for (const card of cards) {
      // Checked between cards so a cancel stops before the next Anki mutation.
      if (isCancelled()) break;
      try {
        if (!card.answer && !card.image) {
          results.push({ card, status: 'failed', reason: 'missing answer and image' });
          continue;
        }

        if (preview) {
          const targetDeck =
            this.settings.useNoteBased && notePath ? deckName : this.settings.defaultDeck;
          results.push({ card, status: 'preview', deckName: targetDeck });
        } else {
          let finalBack = card.answer;
          if (card.image && notePath) {
            try {
              const storedFilename = await this.uploadImageToAnki(card.image, notePath);
              if (storedFilename) {
                if (finalBack) {
                  finalBack += `<br><img src="${storedFilename}">`;
                } else {
                  finalBack = `<img src="${storedFilename}">`;
                }
              }
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : 'Unknown error';
              results.push({ card, status: 'image-failed', reason: msg });
              continue;
            }
          }

          const updateStatus = await this.updateExistingCard(
            card,
            deckName,
            finalBack,
            notePath,
            noteContent
          );

          if (updateStatus.status === 'updated') {
            results.push({ card, status: 'updated', deckName });
          } else if (updateStatus.status === 'identical') {
            results.push({ card, status: 'skipped-identical', deckName });
          } else {
            try {
              await this.ankiConnectRequest('addNote', {
                note: {
                  deckName: deckName,
                  modelName: this.settings.noteType,
                  fields: {
                    Front: card.question,
                    Back: finalBack,
                  },
                  tags: [
                    'panda-zap',
                    'obsidian',
                    ...(notePath ? [this.getSourceTag(notePath)] : []),
                  ],
                },
              });
              results.push({ card, status: 'added', deckName });
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message.toLowerCase() : '';
              if (msg.includes('duplicate') || msg.includes('cannot create note')) {
                results.push({ card, status: 'skipped-existing', deckName });
              } else {
                throw err;
              }
            }
          }
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        results.push({ card, status: 'failed', reason: msg });
      } finally {
        processedCards += 1;
        runOptions?.onProgress?.(processedCards, totalCards);
      }
    }

    const result: SyncResult = { cards: results };

    // A cancellation stops before a delete that has not started. Notes deleted
    // by an earlier note in a batch keep their result.
    if (!preview && deleteConfirmed && notePath && !isCancelled()) {
      try {
        const toDelete = confirmedDeletionIds
          ? [...new Set(confirmedDeletionIds.filter(Boolean))]
          : (
              await this.analyzeSyncOperation(cards, notePath, noteContent, skipConnectionTest)
            ).cardsToDelete
              .map((d) => d.existingCardId)
              .filter((id): id is string => Boolean(id));
        if (toDelete.length > 0) {
          await this.ankiConnectRequest('deleteNotes', { notes: toDelete });
          result.deletion = { deletedCount: toDelete.length, failed: false };
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        result.deletion = { deletedCount: 0, failed: true, reason: msg };
      }
    }

    return result;
  }

  private async updateExistingCard(
    card: AnkiCard,
    deckName: string,
    backContentOverride?: string,
    notePath?: string,
    noteContent?: string
  ): Promise<{ status: 'updated' | 'identical' | 'missing' }> {
    await this.prefetchNotesForDeck(deckName);
    const cached = this.selectCacheEntry(card, notePath, deckName, noteContent);
    const noteId = cached?.noteId;

    const targetBack = backContentOverride !== undefined ? backContentOverride : card.answer;

    if (noteId) {
      let isIdentical = false;
      try {
        const front = (cached?.fields?.Front?.value ?? '').trim();
        const back = (cached?.fields?.Back?.value ?? '').trim();
        const qTrim = (card.question || '').trim();
        const aTrim = (targetBack || '').trim();

        if (fieldsMatch(front, qTrim)) {
          if (fieldsMatch(back, aTrim)) {
            isIdentical = true;
          }
        }
      } catch (e: unknown) {
        console.warn('PandaZap: failed to compare cached note fields', e);
      }

      if (isIdentical) {
        await this.ensureSourceTag(noteId, cached, notePath);
        return { status: 'identical' };
      }

      await this.ankiConnectRequest('updateNoteFields', {
        note: {
          id: noteId,
          fields: {
            Front: card.question,
            Back: targetBack,
          },
        },
      });
      await this.ensureSourceTag(noteId, cached, notePath);
      if (cached) {
        if (cached.fields.Front) cached.fields.Front.value = card.question;
        if (cached.fields.Back) cached.fields.Back.value = targetBack;
      }
      return { status: 'updated' };
    }

    return { status: 'missing' };
  }

  /**
   * Picks the cached note that belongs to the source note. The Front field alone
   * is not unique: several notes can share a question, in note-based decks and
   * especially in one shared default deck, so ownership is decided by source tag.
   */
  private selectCacheEntry(
    card: AnkiCard,
    notePath?: string,
    deckName?: string,
    noteContent?: string
  ): NoteCacheEntry | undefined {
    const entries = this.noteCache?.byFront.get(normalizeField(card.question || ''));
    if (!entries?.length) return undefined;

    // Without a source note there is no ownership to match, so never claim a
    // note that may belong to another source.
    if (!notePath) return undefined;

    const [sourceTag, legacySourceTag] = this.getSourceTags(notePath);
    const exact = entries.find((entry) => entry.raw.tags?.includes(sourceTag));
    if (exact) return exact;
    if (this.canUseLegacySourceTag(notePath, deckName, noteContent)) {
      const legacy = entries.find((entry) => entry.raw.tags?.includes(legacySourceTag));
      if (legacy) return legacy;
    }
    return undefined;
  }

  private async ensureSourceTag(
    noteId: string,
    cached: NoteCacheEntry,
    notePath?: string
  ): Promise<void> {
    if (!notePath) return;
    const sourceTag = this.getSourceTag(notePath);
    if (cached.raw.tags?.includes(sourceTag)) return;

    const allTags = [...new Set([...(cached.raw.tags ?? []), sourceTag])];
    await this.ankiConnectRequest('updateNoteTags', {
      note: parseInt(noteId, 10),
      tags: allTags,
    });
    cached.raw.tags = allTags;
  }

  /**
   * Moves the notes saved under one vault path onto the source tag of another,
   * so a renamed or moved note keeps the Anki notes it already has. Each note is
   * retagged in place with its other tags intact, and moved to the deck the new
   * path or its `Deck::` override targets when that differs from its current
   * deck. Returns how many notes carried the old tag.
   */
  async migrateSourceTag(fromPath: string, toPath: string, toContent?: string): Promise<number> {
    const fromTag = this.getSourceTag(fromPath);
    const toTag = this.getSourceTag(toPath);
    if (fromTag === toTag) return 0;

    const noteIds = (await this.ankiConnectRequest('findNotes', {
      query: `tag:${PLUGIN_TAG} tag:${fromTag}`,
    })) as string[];
    if (!Array.isArray(noteIds)) throw new Error('Anki returned invalid note IDs');
    // No note carries the old tag, so there is nothing to migrate and the queue
    // entry is finished.
    if (noteIds.length === 0) return 0;

    const notesInfo = (await this.ankiConnectRequest('notesInfo', {
      notes: noteIds,
    })) as AnkiNoteInfo[];
    if (!Array.isArray(notesInfo)) throw new Error('Anki returned invalid note information');

    const targetDeck = this.getDeckName(toPath, toContent);
    const cardsByNote = await this.fetchCardsByNote(notesInfo);

    for (const note of notesInfo) {
      const noteId = note.noteId ?? note.noteIds?.[0] ?? note.id ?? '';
      if (!noteId) continue;

      // The deck moves first. If the tag update then fails, the note still
      // carries the old tag, so the retry finds it again; the other order would
      // retag it and lose the pending deck move.
      const cards = cardsByNote.get(noteId) ?? [];
      const decks = cards
        .map((card) => card.deckName)
        .filter((deck): deck is string => Boolean(deck));
      if (decks.length > 0 && decks.some((deck) => deck !== targetDeck)) {
        await this.ankiConnectRequest('changeDeck', {
          cards: cards.map((card) => card.cardId),
          deck: targetDeck,
        });
      }

      const tags = (note.tags ?? []).filter((tag) => tag !== fromTag);
      if (!tags.includes(toTag)) tags.push(toTag);
      await this.ankiConnectRequest('updateNoteTags', {
        note: parseInt(noteId, 10),
        tags,
      });
    }

    // Tags and decks changed under the cached notes.
    this.invalidateCache();
    return notesInfo.length;
  }

  /** Card details per note, so a source tag migration can move decks. */
  private async fetchCardsByNote(
    notes: readonly AnkiNoteInfo[]
  ): Promise<Map<string, AnkiCardInfo[]>> {
    const byNote = new Map<string, AnkiCardInfo[]>();
    const cardIds = new Set<number>();
    for (const note of notes) {
      const noteId = note.noteId ?? note.noteIds?.[0] ?? note.id ?? '';
      if (!noteId) continue;
      byNote.set(noteId, []);
      for (const cardId of note.cards ?? []) {
        if (typeof cardId === 'number') cardIds.add(cardId);
      }
    }
    if (cardIds.size === 0) return byNote;

    const cardsInfo = (await this.ankiConnectRequest('cardsInfo', {
      cards: [...cardIds],
    })) as AnkiCardInfo[];
    if (!Array.isArray(cardsInfo)) throw new Error('Anki returned invalid card information');
    for (const card of cardsInfo) {
      if (typeof card?.note !== 'number') continue;
      const entries = byNote.get(String(card.note));
      if (entries) entries.push(card);
    }
    return byNote;
  }

  /** Every media file the plugin has uploaded to Anki. */
  async getPluginMediaFiles(): Promise<string[]> {
    const names = (await this.ankiConnectRequest('getMediaFilesNames', {
      pattern: `${MEDIA_FILENAME_PREFIX}*`,
    })) as string[];
    if (!Array.isArray(names) || names.some((name) => typeof name !== 'string')) {
      throw new Error('Anki returned invalid media file names');
    }
    return names;
  }

  /** Media filenames referenced by any field of any plugin-tagged note. */
  async getReferencedMediaFiles(): Promise<Set<string>> {
    const noteIds = (await this.ankiConnectRequest('findNotes', {
      query: `tag:${PLUGIN_TAG}`,
    })) as string[];
    if (!Array.isArray(noteIds)) throw new Error('Anki returned invalid note IDs');
    const referenced = new Set<string>();
    if (noteIds.length === 0) return referenced;

    const notesInfo = (await this.ankiConnectRequest('notesInfo', {
      notes: noteIds,
    })) as AnkiNoteInfo[];
    if (!Array.isArray(notesInfo)) throw new Error('Anki returned invalid note information');
    for (const note of notesInfo) {
      for (const field of Object.values(note.fields ?? {})) {
        if (!field || typeof field.value !== 'string') continue;
        for (const name of extractMediaFilenames(field.value)) referenced.add(name);
      }
    }
    return referenced;
  }

  /** Deletes the named files from Anki's media folder, returning how many went. */
  async removeMediaFiles(filenames: readonly string[]): Promise<number> {
    let deleted = 0;
    for (const filename of filenames) {
      await this.ankiConnectRequest('deleteMediaFile', { filename });
      deleted += 1;
    }
    return deleted;
  }

  private async uploadImageToAnki(imagePath: string, notePath: string): Promise<string | null> {
    const source = resolveImageSource(this.app, imagePath, notePath);
    if (!source) throw new Error(`Could not resolve image path: ${imagePath}`);

    let base64: string;
    if (typeof source === 'string') {
      base64 = await downloadImageToBase64(source);
    } else if (source instanceof TFile) {
      base64 = await readImageFileToBase64(this.app, source);
    } else {
      return null;
    }

    const safeFilename = getStoredMediaFilenameForSource(source, notePath);

    const result = (await this.ankiConnectRequest('storeMediaFile', {
      filename: safeFilename,
      data: base64,
    })) as string;
    return result;
  }

  private async prefetchNotesForDeck(deckName: string): Promise<void> {
    if (this.noteCache && this.noteCache.deckName === deckName) return;
    const noteCache = { deckName, byFront: new Map<string, NoteCacheEntry[]>() };
    const query = `deck:"${deckName}" tag:${PLUGIN_TAG}`;
    const noteIds = (await this.ankiConnectRequest('findNotes', { query })) as string[];
    if (!Array.isArray(noteIds)) throw new Error('Anki returned invalid note IDs');

    if (!noteIds || noteIds.length === 0) {
      this.noteCache = noteCache;
      return;
    }

    const notesInfo = (await this.ankiConnectRequest('notesInfo', {
      notes: noteIds,
    })) as AnkiNoteInfo[];
    if (!Array.isArray(notesInfo)) throw new Error('Anki returned invalid note information');

    for (const ni of notesInfo) {
      try {
        const frontValue = ni.fields?.Front?.value ?? '';
        const front = frontValue.trim();
        const key = normalizeField(front);
        const id = ni.noteId ?? ni.noteIds?.[0] ?? ni.id ?? '';
        if (!id) continue;
        const entry: NoteCacheEntry = { noteId: id, fields: ni.fields, raw: ni };
        const existing = noteCache.byFront.get(key);
        if (existing) {
          existing.push(entry);
        } else {
          noteCache.byFront.set(key, [entry]);
        }
      } catch (e: unknown) {
        console.warn('PandaZap: error caching note', e);
      }
    }
    this.noteCache = noteCache;
  }

  private getDeckNameFromPath(notePath?: string): string {
    if (!notePath) return '';

    const pathParts = notePath.split('/');
    const noteNameWithExt = pathParts.pop() || 'Unknown';
    const noteName = noteNameWithExt.replace(/\.md$/, '');
    const folderPath = pathParts.length > 0 ? pathParts.join('/') : '';

    if (folderPath) {
      return `${folderPath}::${noteName}`;
    } else {
      return noteName;
    }
  }

  private getDeckName(notePath?: string, noteContent?: string): string {
    const deckOverride = this.getDeckOverride(noteContent);
    if (deckOverride) return deckOverride;

    if (!this.settings.useNoteBased || !notePath) {
      return this.settings.defaultDeck;
    }

    return this.getDeckNameFromPath(notePath);
  }

  private getSourceTag(notePath: string): string {
    const legacyTag = this.getLegacySourceTag(notePath);
    const hash = stableHash(notePath.replace(/\\/g, '/'));
    return `${legacyTag.slice(0, 80 - hash.length - 1)}_${hash}`;
  }

  private getLegacySourceTag(notePath: string): string {
    const s = notePath.replace(/[/\\]/g, '_').replace(/[\s,]+/g, '_');
    return `source:${s}`.slice(0, 80);
  }

  private getSourceTags(notePath: string): [string, string] {
    return [this.getSourceTag(notePath), this.getLegacySourceTag(notePath)];
  }

  private getEligibleSourceTags(
    notePath: string,
    deckName: string,
    noteContent?: string
  ): string[] {
    const [sourceTag, legacySourceTag] = this.getSourceTags(notePath);
    return this.canUseLegacySourceTag(notePath, deckName, noteContent)
      ? [sourceTag, legacySourceTag]
      : [sourceTag];
  }

  /**
   * A legacy tag can be truncated before the unique part of a long path. It is
   * therefore only authoritative when the note's path also determines a unique
   * deck. A deck override can place multiple source notes in one shared deck.
   */
  private canUseLegacySourceTag(
    notePath: string,
    deckName?: string,
    noteContent?: string
  ): boolean {
    if (!this.settings.useNoteBased) return false;
    if (this.isLegacySourceTagLossless(notePath)) return true;
    return (
      Boolean(deckName && deckName === this.getDeckNameFromPath(notePath)) &&
      !this.getDeckOverride(noteContent)
    );
  }

  private isLegacySourceTagLossless(notePath: string): boolean {
    const normalized = notePath.replace(/[/\\]/g, '_').replace(/[\s,]+/g, '_');
    return `source:${normalized}`.length <= 80;
  }

  private getDeckOverride(noteContent?: string): string | undefined {
    if (!noteContent || !this.settings.deckOverrideWord) return undefined;
    const nl = noteContent.indexOf('\n');
    const firstLine = (nl === -1 ? noteContent : noteContent.slice(0, nl)).replace(/\r$/, '');
    const esc = escapeRegex(this.settings.deckOverrideWord);
    const match = firstLine.match(new RegExp(`^${esc}::\\s*(.+)$`, 'i'));
    return match?.[1]?.trim().replace(/\//g, '::') || undefined;
  }

  private sleep(ms: number) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  private async ankiConnectRequest(
    action: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    const url = buildAnkiConnectUrl(this.settings);
    const body = JSON.stringify({ action, version: ANKI_CONNECT_VERSION, params });
    const timeoutMessage = `Anki Connect request "${action}" timed out after ${REQUEST_TIMEOUT_MS} ms. Make sure Anki is running with the AnkiConnect addon and that ${url} is reachable.`;

    const MAX_RETRIES = 2;
    const isIdempotent = action !== 'addNote' && action !== 'storeMediaFile';

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await withTimeout(
          requestUrl({
            url,
            method: 'POST',
            contentType: 'application/json',
            body,
            throw: false,
          }),
          timeoutMessage
        );

        if (response.status < 200 || response.status >= 300) {
          throw new Error(`Anki Connect HTTP ${response.status}`);
        }
        const data = response.json as AnkiConnectResponse;
        if (
          !data ||
          typeof data !== 'object' ||
          !Object.prototype.hasOwnProperty.call(data, 'result') ||
          !Object.prototype.hasOwnProperty.call(data, 'error') ||
          (data.error !== null && typeof data.error !== 'string')
        ) {
          throw new Error('Invalid response from Anki Connect');
        }
        if (data.error) {
          throw new Error(data.error);
        }
        return data.result;
      } catch (error: unknown) {
        const shouldRetry =
          (isNetworkError(error) || isTimeoutError(error)) && isIdempotent && attempt < MAX_RETRIES;
        if (shouldRetry) {
          const backoff = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt);
          await this.sleep(backoff + Math.random() * (RETRY_BACKOFF_BASE_MS * 0.15));
          continue;
        }
        throw error;
      }
    }
  }
}

function isNetworkError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TypeError' ||
      error.message === 'Failed to fetch' ||
      error.message.includes('net::'))
  );
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}

function normalizeField(s: string): string {
  return (s || '').toString().trim();
}

/** Settings that change which notes a cached deck lookup would return. */
function cacheKeyFor(settings: PandaZapSettings): string {
  return [
    settings.ankiConnectUrl,
    settings.ankiConnectPort,
    settings.useNoteBased,
    settings.defaultDeck,
    settings.deckOverrideWord,
  ].join('\0');
}

function normalizeHtmlField(value: string): string {
  let result = value.trim();
  result = result.replace(/&nbsp;/g, ' ');
  result = result.replace(/&amp;/g, '&');
  result = result.replace(/&lt;/g, '<');
  result = result.replace(/&gt;/g, '>');
  result = result.replace(/&quot;/g, '"');
  result = result.replace(/<br\s*\/?>/gi, '\n');
  result = result.replace(/<\/?div>/gi, '\n');
  result = result.replace(/<\/?p>/gi, '\n');
  result = result.replace(/<\/?span[^>]*>/gi, '');
  result = result.replace(/\r\n/g, '\n');
  result = result.replace(/\n{3,}/g, '\n\n');
  result = result.trim();
  return result;
}

function fieldsMatch(a: string, b: string): boolean {
  return normalizeHtmlField(a) === normalizeHtmlField(b);
}

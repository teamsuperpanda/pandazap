import { App, TFile } from 'obsidian';
import {
  AnkiCard,
  PandaZapSettings,
  SyncAnalysis,
  CardSyncInfo,
  AnkiNoteInfo,
  AnkiCardInfo,
  NoteCacheEntry,
  AnkiConnectionState,
  SyncCardResult,
  SyncResult,
  SyncRunOptions,
  SourceTagMigrationResult,
  describeConnection,
} from './types';
import {
  ANKI_CONNECT_VERSION,
  PLUGIN_TAG,
  SYNC_HASH_TAG_PREFIX,
  MEDIA_FILENAME_PREFIX,
  REQUEST_TIMEOUT_MS,
} from '../constants';
import { buildAnkiConnectUrl } from '../settings';
import { extractDeckOverride, extractQACardsFromText } from './extractionUtils';
import { stableHash } from './hashUtils';
import { AnkiConnectClient, isNetworkError, isTimeoutError } from './AnkiConnectClient';
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
  private client: AnkiConnectClient;
  private clientEndpoint: string;

  constructor(settings: PandaZapSettings, app: App) {
    this.settings = settings;
    this.app = app;
    this.cacheKey = cacheKeyFor(settings);
    this.clientEndpoint = buildAnkiConnectUrl(settings);
    this.client = new AnkiConnectClient(this.clientEndpoint);
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

  /** The transport keeps the endpoint it was built with, so follow the settings. */
  private clientForCurrentEndpoint(): AnkiConnectClient {
    const endpoint = buildAnkiConnectUrl(this.settings);
    if (endpoint !== this.clientEndpoint) {
      this.clientEndpoint = endpoint;
      this.client = new AnkiConnectClient(endpoint);
    }
    return this.client;
  }

  /** Drop cached notes so the next lookup re-reads Anki. */
  invalidateCache(): void {
    this.noteCache = null;
  }

  async testConnection(): Promise<AnkiConnectionState> {
    try {
      const version = await this.clientForCurrentEndpoint().request('version', undefined, {
        parse: parseVersion,
      });
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

  /**
   * Every deck name Anki knows, for the settings picker. Read-only, so the
   * shared request helper retries it on a network error or timeout.
   */
  async listDeckNames(): Promise<string[]> {
    return this.listNames('deckNames', 'deck');
  }

  /** Every note type (model) name Anki knows, for the settings picker. */
  async listModelNames(): Promise<string[]> {
    return this.listNames('modelNames', 'note type');
  }

  private async listNames(action: 'deckNames' | 'modelNames', label: string): Promise<string[]> {
    const names = await this.ankiConnectRequest(action);
    if (!isStringArray(names)) throw new Error(`Anki returned invalid ${label} names`);
    return names;
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
      cardsInConflict: [],
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
              deckName,
              existingCardId: existingEntry.noteId,
            };
            if (
              this.isExternallyEdited(existingEntry, front, back) &&
              !this.settings.overwriteAnkiEdits
            ) {
              analysis.cardsInConflict.push(cardSyncInfo);
            } else {
              analysis.cardsToUpdate.push(cardSyncInfo);
            }
          }
        } catch (e: unknown) {
          console.warn('PandaZap: failed to compare note info', e);
          throw e;
        }
      } else {
        analysis.cardsToAdd.push({ card, deckName });
      }
    }

    // Deletion is scoped by the plugin tag and the note's source tag, so it
    // applies to the shared default deck as well as to note-based decks.
    if (notePath) {
      const extractedQuestions = new Set(cards.map((c) => normalizeField(c.question || '')));

      const findNotes = async (query: string): Promise<string[]> => {
        const existingNoteIds = (await this.ankiConnectRequest('findNotes', {
          query,
        })) as Array<string | number>;
        if (!Array.isArray(existingNoteIds)) throw new Error('Anki returned invalid note IDs');
        return existingNoteIds.map(String);
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
              const delCard = { question: front, answer: back };
              const noteId = ankiNoteId(ni);
              analysis.cardsToDelete.push({
                card: delCard,
                deckName,
                existingCardId: noteId,
                externallyEdited: this.isExternallyEdited(ni, front, back),
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
    // Silent sync never overwrites an edit made in Anki, even when the setting allows it.
    const skipConflicts = runOptions?.skipConflicts === true;

    if (this.settings.useNoteBased && notePath && cards.length > 0 && !isCancelled()) {
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
          noteContent,
          skipConflicts
        );

        if (updateStatus.status === 'updated') {
          results.push({ card, status: 'updated', deckName });
        } else if (updateStatus.status === 'identical') {
          results.push({ card, status: 'skipped-identical', deckName });
        } else if (updateStatus.status === 'conflict') {
          results.push({ card, status: 'conflict', deckName, reason: 'changed in Anki' });
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
                  this.syncTagFor(card.question, finalBack),
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
    if (deleteConfirmed && notePath && !isCancelled()) {
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
    noteContent?: string,
    skipConflicts = false
  ): Promise<{ status: 'updated' | 'identical' | 'conflict' | 'missing' }> {
    await this.prefetchNotesForDeck(deckName);
    const cached = this.selectCacheEntry(card, notePath, deckName, noteContent);
    const noteId = cached?.noteId;

    const targetBack = backContentOverride !== undefined ? backContentOverride : card.answer;

    if (noteId && cached) {
      const front = (cached.fields.Front?.value ?? '').trim();
      const back = (cached.fields.Back?.value ?? '').trim();
      const qTrim = (card.question || '').trim();
      const aTrim = (targetBack || '').trim();

      if (fieldsMatch(front, qTrim) && fieldsMatch(back, aTrim)) {
        // The note already holds this content. Record the fingerprint so the
        // next edit made in Anki can be detected, without rewriting the fields.
        await this.ensureNoteTags(noteId, cached, notePath, this.syncTagFor(front, back));
        return { status: 'identical' };
      }

      // The stored fingerprint records the Front and Back the plugin last
      // pushed. A different one means the note was edited directly in Anki.
      if (this.isExternallyEdited(cached, front, back)) {
        if (skipConflicts || !this.settings.overwriteAnkiEdits) {
          // Skip the card and leave the note, its fields and its tag untouched.
          return { status: 'conflict' };
        }
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
      await this.ensureNoteTags(
        noteId,
        cached,
        notePath,
        this.syncTagFor(card.question, targetBack)
      );
      if (cached.fields.Front) cached.fields.Front.value = card.question;
      if (cached.fields.Back) cached.fields.Back.value = targetBack;
      return { status: 'updated' };
    }

    return { status: 'missing' };
  }

  /** Fingerprint tag recording the Front and Back the plugin last pushed. */
  private syncTagFor(front: string, back: string): string {
    return `${SYNC_HASH_TAG_PREFIX}${stableHash(`${normalizeHtmlField(front)}\n${normalizeHtmlField(back)}`)}`;
  }

  /**
   * True when a note carries a fingerprint that does not match its current
   * fields. A note without a fingerprint predates edit detection, so it is not
   * treated as edited; the next write records one.
   */
  private isExternallyEdited(
    note: AnkiNoteInfo | NoteCacheEntry,
    front: string,
    back: string
  ): boolean {
    const tags = 'raw' in note ? note.raw.tags : note.tags;
    const stored = tags?.find((tag) => tag.startsWith(SYNC_HASH_TAG_PREFIX));
    return stored !== undefined && stored !== this.syncTagFor(front, back);
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

  /**
   * Makes the note carry the current source tag and exactly one fingerprint
   * tag. The old fingerprint is replaced, never accumulated.
   */
  private async ensureNoteTags(
    noteId: string,
    cached: NoteCacheEntry,
    notePath: string | undefined,
    syncTag: string
  ): Promise<void> {
    const currentTags = cached.raw.tags ?? [];
    const sourceTag = notePath ? this.getSourceTag(notePath) : undefined;
    const withoutSyncTag = currentTags.filter((tag) => !tag.startsWith(SYNC_HASH_TAG_PREFIX));
    const tags = [...new Set([...withoutSyncTag, ...(sourceTag ? [sourceTag] : []), syncTag])];
    if (tags.length === currentTags.length && tags.every((tag, i) => tag === currentTags[i])) {
      return;
    }

    await this.ankiConnectRequest('updateNoteTags', {
      note: Number(noteId),
      tags,
    });
    cached.raw.tags = tags;
  }

  /**
   * Moves the notes saved under one vault path onto the source tag of another,
   * so a renamed or moved note keeps the Anki notes it already has.
   *
   * The hashed tag is unique per path, so those notes are migrated first and
   * always. The legacy tag is truncated to 80 characters and can be shared by
   * deep siblings, so it is searched only when a normal sync would trust it, in
   * the deck the old path targets, and a candidate is migrated only when it has
   * no other path's source tag and its `Front` uniquely matches a card of the
   * renamed note. When that proof fails nothing legacy is touched and the caller
   * is told those older cards may now be orphans.
   */
  async migrateSourceTag(
    fromPath: string,
    toPath: string,
    toContent?: string
  ): Promise<SourceTagMigrationResult> {
    const toTag = this.getSourceTag(toPath);
    const hashedOldTag = this.getSourceTag(fromPath);
    if (hashedOldTag === toTag) return { migrated: 0, unresolvedLegacy: false };
    const legacyOldTag = this.getLegacySourceTag(fromPath);
    // A rename does not edit the note, so the renamed file's content is also the
    // old content and its `Deck::` override applies to the old path.
    const oldDeck = this.getDeckName(fromPath, toContent);
    const newDeck = this.getDeckName(toPath, toContent);
    // Same rule a normal sync uses before trusting a truncated legacy tag.
    const searchLegacy = this.getEligibleSourceTags(
      fromPath,
      this.getDeckName(fromPath, toContent),
      toContent
    ).includes(legacyOldTag);

    const ownedIds = new Set(await this.findPluginNotes(`tag:${PLUGIN_TAG} tag:${hashedOldTag}`));
    // The legacy tag can name several deep siblings, so only the deck the old
    // path targets can hold this note's own cards.
    const legacyIds = searchLegacy
      ? await this.findPluginNotes(`deck:"${oldDeck}" tag:${PLUGIN_TAG} tag:${legacyOldTag}`)
      : [];

    const allIds = [...new Set([...ownedIds, ...legacyIds])];
    if (allIds.length === 0) return { migrated: 0, unresolvedLegacy: false };

    const notesInfo = (await this.ankiConnectRequest('notesInfo', {
      notes: allIds,
    })) as AnkiNoteInfo[];
    if (!Array.isArray(notesInfo)) throw new Error('Anki returned invalid note information');

    const defaultDeckMode = !this.settings.useNoteBased && !this.getDeckOverride(toContent);
    const migrationOptions = {
      oldDeck,
      newDeck,
      moveDeck: !defaultDeckMode && oldDeck !== newDeck,
      toTag,
      removeTags: [hashedOldTag, legacyOldTag],
    };

    // Trusted hashed notes are migrated before the legacy attempt, so a legacy
    // problem never leaves the note's current cards behind.
    const ownedNotes = notesInfo.filter((note) => ownedIds.has(ankiNoteId(note)));
    let migrated = await this.applySourceTagMigration(ownedNotes, migrationOptions);

    const legacyCandidates = this.legacyOwnershipCandidates(
      notesInfo,
      legacyIds,
      hashedOldTag,
      legacyOldTag
    );
    if (legacyCandidates.length === 0) return { migrated, unresolvedLegacy: false };

    const questions = this.noteQuestionKeys(toContent);
    const frontMatches = this.legacyFrontMatches(legacyCandidates, questions);
    // A question carried by more than one candidate cannot decide which note is
    // the renamed one's, so migrating any of them could hijack a sibling. A
    // candidate that is neither the note's own hashed note nor provably its by
    // Front is equally undecidable: it could be a stale card of this note.
    const ambiguous = [...frontMatches.values()].some((count) => count > 1);
    const undecidable = legacyCandidates.some(
      (note) =>
        !ownedIds.has(ankiNoteId(note)) &&
        !questions.has(normalizeHtmlField(note.fields?.Front?.value ?? ''))
    );
    if (ambiguous || undecidable) return { migrated, unresolvedLegacy: true };

    const legacyTargets = legacyCandidates.filter(
      (note) =>
        !ownedIds.has(ankiNoteId(note)) &&
        questions.has(normalizeHtmlField(note.fields?.Front?.value ?? ''))
    );
    migrated += await this.applySourceTagMigration(legacyTargets, migrationOptions);
    return { migrated, unresolvedLegacy: false };
  }

  /**
   * Notes the legacy tag could refer to: carrying the legacy tag, found in the
   * old path's deck, and not already claimed by another path's hashed tag.
   */
  private legacyOwnershipCandidates(
    notes: readonly AnkiNoteInfo[],
    legacyIds: readonly string[],
    hashedOldTag: string,
    legacyOldTag: string
  ): AnkiNoteInfo[] {
    const ids = new Set(legacyIds);
    return notes.filter((note) => {
      if (!ids.has(ankiNoteId(note)) || !note.tags?.includes(legacyOldTag)) return false;
      // A note with a source tag of its own belongs to a different note, even
      // when it also carries this legacy tag.
      return !note.tags?.some(
        (tag) => tag.startsWith('source:') && tag !== hashedOldTag && tag !== legacyOldTag
      );
    });
  }

  /** How many legacy candidates carry each of the renamed note's questions. */
  private legacyFrontMatches(
    candidates: readonly AnkiNoteInfo[],
    questions: ReadonlySet<string>
  ): Map<string, number> {
    const counts = new Map<string, number>();
    for (const note of candidates) {
      const question = normalizeHtmlField(note.fields?.Front?.value ?? '');
      if (!questions.has(question)) continue;
      counts.set(question, (counts.get(question) ?? 0) + 1);
    }
    return counts;
  }

  /** Normalised Front fields of the cards a renamed note contains. */
  private noteQuestionKeys(toContent?: string): Set<string> {
    if (!toContent) return new Set();
    return new Set(
      extractQACardsFromText(toContent, this.settings).map((card) =>
        normalizeHtmlField(card.question || '')
      )
    );
  }

  /** Note IDs matching one AnkiConnect query, as strings. */
  private async findPluginNotes(query: string): Promise<string[]> {
    const found = (await this.ankiConnectRequest('findNotes', { query })) as Array<string | number>;
    if (!Array.isArray(found)) throw new Error('Anki returned invalid note IDs');
    return found.map(String);
  }

  /** Retags the given notes and moves the cards still in the old deck. */
  private async applySourceTagMigration(
    notes: readonly AnkiNoteInfo[],
    options: {
      oldDeck: string;
      newDeck: string;
      moveDeck: boolean;
      toTag: string;
      removeTags: readonly string[];
    }
  ): Promise<number> {
    if (notes.length === 0) return 0;
    const cardsByNote = await this.fetchCardsByNote(notes);

    for (const note of notes) {
      const noteId = ankiNoteId(note);
      if (!noteId) continue;

      // The deck moves first. If the tag update then fails, the note still
      // carries the old tag, so the retry finds it again; the other order would
      // retag it and lose the pending deck move. Only cards still in the deck the
      // old path targeted are moved, so a card the user moved by hand stays put.
      if (options.moveDeck) {
        const cards = cardsByNote.get(noteId) ?? [];
        const cardsToMove = cards
          .filter((card) => card.deckName === options.oldDeck)
          .map((card) => card.cardId);
        if (cardsToMove.length > 0) {
          await this.ankiConnectRequest('changeDeck', {
            cards: cardsToMove,
            deck: options.newDeck,
          });
        }
      }

      const tags = (note.tags ?? []).filter((tag) => !options.removeTags.includes(tag));
      if (!tags.includes(options.toTag)) tags.push(options.toTag);
      await this.ankiConnectRequest('updateNoteTags', {
        note: Number(noteId),
        tags,
      });
    }

    // Tags and decks changed under the cached notes.
    this.invalidateCache();
    return notes.length;
  }

  /** Card details per note, so a source tag migration can move decks. */
  private async fetchCardsByNote(
    notes: readonly AnkiNoteInfo[]
  ): Promise<Map<string, AnkiCardInfo[]>> {
    const byNote = new Map<string, AnkiCardInfo[]>();
    const cardIds = new Set<number>();
    for (const note of notes) {
      const noteId = ankiNoteId(note);
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
      // cardsInfo reports the owning note as a number, so compare as strings.
      if (typeof card?.note !== 'number') continue;
      const entries = byNote.get(String(card.note));
      if (entries) entries.push(card);
    }
    return byNote;
  }

  /**
   * True when Anki already holds at least one plugin note for this vault path.
   * The hashed source tag is tried first, then the legacy tag when the same
   * ownership rule a normal sync uses trusts it. Silent sync uses this to leave
   * notes that were never synced alone.
   */
  async hasNotesForSourceTag(notePath: string, noteContent?: string): Promise<boolean> {
    const deckName = this.getDeckName(notePath, noteContent);
    const sourceTags = new Set(this.getEligibleSourceTags(notePath, deckName, noteContent));
    for (const sourceTag of sourceTags) {
      const noteIds = await this.findPluginNotes(`tag:${PLUGIN_TAG} tag:${sourceTag}`);
      if (noteIds.length > 0) return true;
    }
    return false;
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

  /**
   * Narrows deletion candidates to the files no Anki note references at all.
   * The tagged-note scan cannot see untagged or duplicated notes, so every
   * candidate is checked with a full-text search for its filename. Orphan
   * counts are normally small, but this is one request per candidate; a failure
   * aborts the whole check so nothing is deleted on partial information.
   */
  async filterUnreferencedMedia(filenames: readonly string[]): Promise<string[]> {
    const unreferenced: string[] = [];
    for (const filename of filenames) {
      const found = (await this.ankiConnectRequest('findNotes', {
        query: `"${filename.replace(/"/g, '')}"`,
      })) as Array<string | number>;
      if (!Array.isArray(found)) throw new Error('Anki returned invalid note IDs');
      if (found.length === 0) unreferenced.push(filename);
    }
    return unreferenced;
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
    const foundIds = (await this.ankiConnectRequest('findNotes', { query })) as Array<
      string | number
    >;
    if (!Array.isArray(foundIds)) throw new Error('Anki returned invalid note IDs');
    const noteIds = foundIds.map(String);

    if (noteIds.length === 0) {
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
        const id = ankiNoteId(ni);
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
    if (!noteContent) return undefined;
    return extractDeckOverride(noteContent, this.settings.deckOverrideWord);
  }

  private async ankiConnectRequest(
    action: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    return this.clientForCurrentEndpoint().request(action, params);
  }
}

/** Anki Connect uses numeric note IDs in responses; compare them as strings. */
function ankiNoteId(note: AnkiNoteInfo): string {
  return String(note.noteId ?? note.noteIds?.[0] ?? note.id ?? '');
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** AnkiConnect's version probe must answer with a number. */
function parseVersion(result: unknown): number {
  if (typeof result !== 'number') throw new Error('Anki returned an invalid version');
  return result;
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

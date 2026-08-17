import { App, TFile, requestUrl } from 'obsidian';
import {
  AnkiCard,
  PandaZapSettings,
  SyncAnalysis,
  CardAction,
  CardSyncInfo,
  AnkiNoteInfo,
  AnkiConnectResponse,
  NoteCacheEntry,
} from './types';
import { ANKI_CONNECT_VERSION, PLUGIN_TAG, DEFAULT_TIMEOUT_MS } from '../constants';
import { stableHash } from './hashUtils';
import {
  resolveImageSource,
  readImageFileToBase64,
  downloadImageToBase64,
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

  constructor(settings: PandaZapSettings, app: App) {
    this.settings = settings;
    this.app = app;
  }

  /** Update settings and invalidate any cached data. Call when settings change. */
  updateSettings(newSettings: PandaZapSettings): void {
    this.settings = newSettings;
    this.noteCache = null;
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await this.ankiConnectRequest('version');
      return typeof response === 'number' && response >= ANKI_CONNECT_VERSION;
    } catch (e: unknown) {
      console.warn('PandaZap: connection test failed', e);
      return false;
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

    if (!skipConnectionTest && !(await this.testConnection())) {
      throw new Error(
        'Cannot connect to Anki Connect. Make sure Anki is running with AnkiConnect addon installed.'
      );
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

    if (this.settings.useNoteBased && notePath) {
      const extractedQuestions = new Set(cards.map((c) => normalizeField(c.question || '')));

      const findNotes = async (query: string): Promise<string[]> => {
        const existingNoteIds = (await this.ankiConnectRequest('findNotes', {
          query,
        })) as string[];
        if (!Array.isArray(existingNoteIds)) throw new Error('Anki returned invalid note IDs');
        return existingNoteIds;
      };

      const sourceTags = this.getEligibleSourceTags(notePath, deckName, noteContent);
      const noteIds = new Set<string>();
      for (const sourceTag of sourceTags) {
        const query = `deck:"${deckName}" tag:${PLUGIN_TAG} tag:${sourceTag}`;
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
    skipConnectionTest: boolean = false
  ): Promise<string[]> {
    if (!skipConnectionTest && !(await this.testConnection())) {
      throw new Error(
        'Cannot connect to Anki Connect. Make sure Anki is running with AnkiConnect addon installed.'
      );
    }

    const results: string[] = [];
    const deckName = this.getDeckName(notePath, noteContent);
    if (this.settings.useNoteBased && notePath && !preview) {
      try {
        await this.ankiConnectRequest('createDeck', {
          deck: deckName,
        });
      } catch (e: unknown) {
        console.warn('PandaZap: deck creation error', e);
      }
    }

    for (const card of cards) {
      try {
        if (!card.answer && !card.image) {
          results.push(`Skipped invalid card (missing answer and image): ${card.question}`);
          continue;
        }

        if (preview) {
          const targetDeck =
            this.settings.useNoteBased && notePath ? deckName : this.settings.defaultDeck;
          const qWord = (this.settings.questionWord || '').trim() || 'Q';
          const aWord = (this.settings.answerWord || '').trim() || 'A';
          const qTag = `${qWord}:`;
          const aTag = `${aWord}:`;
          const iInfo = card.image ? ` | Image: ${card.image}` : '';
          const aInfo = card.answer ? `${card.answer}` : '(image only)';

          results.push(
            `Preview: ${qTag} ${card.question} | ${aTag} ${aInfo}${iInfo} | Deck: ${targetDeck}`
          );
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
              results.push(`Image failed (${card.image}): ${msg}`);
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
            results.push(`Updated: ${card.question} -> ${deckName}`);
          } else if (updateStatus.status === 'identical') {
            results.push(`Skipped (already up-to-date): ${card.question} -> ${deckName}`);
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
              results.push(`Added: ${card.question} -> ${deckName}`);
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message.toLowerCase() : '';
              if (msg.includes('duplicate') || msg.includes('cannot create note')) {
                results.push(`Skipped (already exists): ${card.question} -> ${deckName}`);
              } else {
                throw err;
              }
            }
          }
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        results.push(`Failed: ${card.question} - ${msg}`);
      }
    }

    if (!preview && deleteConfirmed && this.settings.useNoteBased && notePath) {
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
          results.push(`Deleted ${toDelete.length} notes from Anki`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        results.push(`Failed to delete notes: ${msg}`);
      }
    }

    return results;
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

  private selectCacheEntry(
    card: AnkiCard,
    notePath?: string,
    deckName?: string,
    noteContent?: string
  ): NoteCacheEntry | undefined {
    const entries = this.noteCache?.byFront.get(normalizeField(card.question || ''));
    if (!entries?.length) return undefined;

    if (notePath) {
      const [sourceTag, legacySourceTag] = this.getSourceTags(notePath);
      const exact = entries.find((entry) => entry.raw.tags?.includes(sourceTag));
      if (exact) return exact;
      if (this.canUseLegacySourceTag(notePath, deckName, noteContent)) {
        const legacy = entries.find((entry) => entry.raw.tags?.includes(legacySourceTag));
        if (legacy) return legacy;
      }
      if (this.settings.useNoteBased) return undefined;
    }

    if (this.settings.useNoteBased) return undefined;
    return entries[0];
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

  private async uploadImageToAnki(imagePath: string, notePath: string): Promise<string | null> {
    const source = resolveImageSource(this.app, imagePath, notePath);
    if (!source) throw new Error(`Could not resolve image path: ${imagePath}`);

    let base64 = '';
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
    const esc = this.settings.deckOverrideWord.replace(/[.*+?^${}(|[\]\\]/g, '\\$&');
    const match = firstLine.match(new RegExp(`^${esc}::\\s*(.+)$`, 'i'));
    return match?.[1]?.trim().replace(/\//g, '::') || undefined;
  }

  private buildAnkiConnectUrl(): string {
    try {
      const maybeUrl = String(this.settings.ankiConnectUrl || 'http://127.0.0.1');
      let u: URL;
      try {
        u = new URL(maybeUrl);
      } catch {
        u = new URL(`http://${maybeUrl}`);
      }
      if ((!u.port || u.port === '') && this.settings.ankiConnectPort) {
        u.port = String(this.settings.ankiConnectPort);
      }
      return u.toString();
    } catch {
      return `http://127.0.0.1:${this.settings.ankiConnectPort || 8765}`;
    }
  }

  private sleep(ms: number) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  private async ankiConnectRequest(
    action: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    const url = this.buildAnkiConnectUrl();
    const body = JSON.stringify({ action, version: ANKI_CONNECT_VERSION, params });

    const MAX_RETRIES = 2;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await requestUrl({
          url,
          method: 'POST',
          contentType: 'application/json',
          body,
          throw: false,
        });

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
        const isNetwork =
          error instanceof Error &&
          (error.name === 'TypeError' ||
            error.message === 'Failed to fetch' ||
            error.message.includes('net::'));
        const shouldRetry = isNetwork && attempt < MAX_RETRIES;
        if (shouldRetry) {
          const backoff = DEFAULT_TIMEOUT_MS * 0.2 * Math.pow(2, attempt);
          await this.sleep(backoff + Math.random() * (DEFAULT_TIMEOUT_MS * 0.03));
          continue;
        }
        throw error;
      }
    }
  }
}

function normalizeField(s: string): string {
  return (s || '').toString().trim();
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

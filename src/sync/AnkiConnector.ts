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
import {
  resolveImageSource,
  readImageFileToBase64,
  downloadImageToBase64,
  getImageFilename,
  sanitizeMediaFilename,
} from './imageUtils';
import { normalizeSettings } from './markers';

const SOURCE_TAG_PREFIX = 'source:';

export class AnkiConnector {
  private settings: PandaZapSettings;
  private app: App;
  private noteCache: {
    deckName: string;
    byFront: Map<string, NoteCacheEntry[]>;
    noteIds: string[];
  } | null = null;

  constructor(settings: PandaZapSettings, app: App) {
    this.settings = settings;
    this.app = app;
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await this.ankiConnectRequest('version', ANKI_CONNECT_VERSION);
      return response !== null;
    } catch (e: unknown) {
      console.warn('PandaZap: connection test failed', e);
      return false;
    }
  }

  async analyzeSyncOperation(
    cards: AnkiCard[],
    notePath?: string,
    noteContent?: string
  ): Promise<SyncAnalysis> {
    const analysis: SyncAnalysis = {
      cardsToAdd: [],
      cardsToUpdate: [],
      cardsToDelete: [],
      totalCards: cards.length,
    };

    if (!(await this.testConnection())) {
      throw new Error(
        'Cannot connect to Anki Connect. Make sure Anki is running with AnkiConnect addon installed.'
      );
    }

    const deckName = this.getDeckName(notePath, noteContent);

    for (const card of cards) {
      try {
        const existingCardId = await this.findExistingCard(card, deckName, notePath);

        if (existingCardId) {
          try {
            const infoResult = (await this.ankiConnectRequest('notesInfo', ANKI_CONNECT_VERSION, {
              notes: [existingCardId],
            })) as AnkiNoteInfo[];
            const ni = infoResult?.[0];
            const front = (ni?.fields?.Front?.value ?? '').trim();
            const back = (ni?.fields?.Back?.value ?? '').trim();
            const qTrim = (card.question || '').trim();

            let match = false;

            if (fieldsMatch(front, qTrim)) {
              if (card.image) {
                const filename = getImageFilename(card.image);
                const encodedFilename = encodeURI(filename);
                const spaceEncodedFilename = filename.replace(/ /g, '%20');
                const underscoreFilename = filename.replace(/ /g, '_');

                const hasFilename =
                  back.includes(filename) ||
                  back.includes(encodedFilename) ||
                  back.includes(spaceEncodedFilename) ||
                  back.includes(underscoreFilename);

                const aTrim = (card.answer || '').trim();
                const hasAnswer = !aTrim || back.includes(aTrim);
                const hasImgTag = back.includes('<img');

                if (hasAnswer && hasImgTag && hasFilename) {
                  match = true;
                }
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
                existingCardId,
              };
              analysis.cardsToUpdate.push(cardSyncInfo);
            }
          } catch (e: unknown) {
            console.warn('PandaZap: failed to fetch note info for comparison', e);
            const cardSyncInfo: CardSyncInfo = {
              card,
              action: CardAction.UPDATE,
              deckName,
              existingCardId,
            };
            analysis.cardsToUpdate.push(cardSyncInfo);
          }
        } else {
          analysis.cardsToAdd.push({ card, action: CardAction.ADD, deckName });
        }
      } catch (e: unknown) {
        console.warn('PandaZap: error analyzing card', card.question, e);
        analysis.cardsToAdd.push({
          card,
          action: CardAction.ADD,
          deckName,
        });
      }
    }

    if (this.settings.useNoteBased && notePath) {
      try {
        const extractedQuestions = new Set(cards.map((c) => (c.question || '').trim()));

        const findAndMarkDeletions = async (query: string): Promise<boolean> => {
          const existingNoteIds = (await this.ankiConnectRequest(
            'findNotes', ANKI_CONNECT_VERSION, { query }
          )) as string[];
          if (!existingNoteIds || existingNoteIds.length === 0) return false;

          const notesInfo = (await this.ankiConnectRequest('notesInfo', ANKI_CONNECT_VERSION, {
            notes: existingNoteIds,
          })) as AnkiNoteInfo[];

          for (const ni of notesInfo) {
            try {
              const front = ni.fields?.Front?.value?.trim() ?? '';
              const back = ni.fields?.Back?.value?.trim() ?? '';
              if (front && !extractedQuestions.has(front)) {
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
          return true;
        };

        const sourceTag = this.getSourceTag(notePath);
        const scopedQuery = `deck:"${deckName}" tag:${PLUGIN_TAG} tag:${sourceTag}`;
        await findAndMarkDeletions(scopedQuery);
      } catch (e: unknown) {
        console.warn('PandaZap: deletion detection failed', e);
      }
    }

    return analysis;
  }

  private async findExistingCard(card: AnkiCard, deckName: string, notePath?: string): Promise<string | null> {
    try {
      await this.prefetchNotesForDeck(deckName);
      if (this.noteCache?.byFront) {
        const key = normalizeField(card.question || '');
        const entries = this.noteCache.byFront.get(key);
        if (entries && entries.length > 0) {
          const sourceTag = notePath ? this.getSourceTag(notePath) : undefined;
          const tagged = sourceTag ? entries.filter((e) => e.raw?.tags?.includes(sourceTag)) : [];
          if (tagged.length > 0) return tagged[0].noteId ?? null;
          return entries[0].noteId ?? null;
        }
      }
      return null;
    } catch (e: unknown) {
      console.warn('PandaZap: findExistingCard failed', e);
      return null;
    }
  }

  async syncCards(
    cards: AnkiCard[],
    preview: boolean = false,
    notePath?: string,
    noteContent?: string,
    deleteConfirmed: boolean = false
  ): Promise<string[]> {
    if (!(await this.testConnection())) {
      throw new Error(
        'Cannot connect to Anki Connect. Make sure Anki is running with AnkiConnect addon installed.'
      );
    }

    const results: string[] = [];
    const deckName = this.getDeckName(notePath, noteContent);
    const markers = normalizeSettings(this.settings);

    if (this.settings.useNoteBased && notePath && !preview) {
      try {
        await this.ankiConnectRequest('createDeck', 6, {
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
          const qTag = `${markers.questionWord}:`;
          const aTag = `${markers.answerWord}:`;
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
            }
          }

          const updateStatus = await this.updateExistingCard(card, deckName, finalBack, notePath);

          if (updateStatus.status === 'updated') {
            results.push(`Updated: ${card.question} -> ${deckName}`);
          } else if (updateStatus.status === 'identical') {
            results.push(`Skipped (already up-to-date): ${card.question} -> ${deckName}`);
          } else {
            try {
              await this.ankiConnectRequest('addNote', 6, {
                note: {
                  deckName: deckName,
                  modelName: this.settings.noteType,
                  fields: {
                    Front: card.question,
                    Back: finalBack,
                  },
                  tags: ['panda-zap', 'obsidian', ...(notePath ? [this.getSourceTag(notePath)] : [])],
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
        const analysis = await this.analyzeSyncOperation(cards, notePath, noteContent);
        const toDelete = analysis.cardsToDelete
          .map((d) => d.existingCardId)
          .filter((id): id is string => Boolean(id));
        if (toDelete.length > 0) {
          await this.ankiConnectRequest('deleteNotes', 6, { notes: toDelete });
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
    notePath?: string
  ): Promise<{ status: 'updated' | 'identical' | 'missing' }> {
    try {
      await this.prefetchNotesForDeck(deckName);
      let noteId: string | undefined;
      if (this.noteCache?.byFront) {
        const key = normalizeField(card.question || '');
        const entries = this.noteCache.byFront.get(key);
        if (entries && entries.length > 0) {
          const sourceTag = notePath ? this.getSourceTag(notePath) : undefined;
          const tagged = sourceTag ? entries.filter((e) => e.raw?.tags?.includes(sourceTag)) : [];
          noteId = tagged.length > 0 ? tagged[0].noteId : entries[0].noteId;
        }
      }

      const targetBack = backContentOverride !== undefined ? backContentOverride : card.answer;

      if (noteId) {
        const entries = this.noteCache?.byFront.get(normalizeField(card.question || ''));
        const cached = entries?.[0];
        try {
          const front = (cached?.fields?.Front?.value ?? '').trim();
          const back = (cached?.fields?.Back?.value ?? '').trim();
          const qTrim = (card.question || '').trim();
          const aTrim = (targetBack || '').trim();

          let isIdentical = false;

          if (fieldsMatch(front, qTrim)) {
             if (card.image) {
                const filename = getImageFilename(card.image);
                const encodedFilename = encodeURI(filename);
                const spaceEncodedFilename = filename.replace(/ /g, '%20');
                const underscoreFilename = filename.replace(/ /g, '_');

                const hasFilename =
                  back.includes(filename) ||
                  back.includes(encodedFilename) ||
                  back.includes(spaceEncodedFilename) ||
                  back.includes(underscoreFilename);

                const textPart = card.answer ? card.answer.trim() : '';
                const hasAnswer = !textPart || back.includes(textPart);
                const hasImgTag = back.includes('<img');

                if (hasAnswer && hasImgTag && hasFilename) {
                  isIdentical = true;
                }
             } else {
                 if (fieldsMatch(back, aTrim)) {
                     isIdentical = true;
                 }
             }
          }

          if (isIdentical) {
            return { status: 'identical' };
          }
        } catch (e: unknown) {
          console.warn('PandaZap: failed to compare cached note fields', e);
        }

        await this.ankiConnectRequest('updateNoteFields', 6, {
          note: {
            id: noteId,
            fields: {
              Front: card.question,
              Back: targetBack,
            },
          },
        });
        if (notePath && cached?.raw?.tags) {
          const sourceTag = this.getSourceTag(notePath);
          if (!cached.raw.tags.includes(sourceTag)) {
            try {
              const allTags = [...new Set([...(cached.raw.tags ?? []), sourceTag])];
              await this.ankiConnectRequest('updateNoteTags', 6, {
                note: parseInt(noteId, 10),
                tags: allTags,
              });
            } catch (e: unknown) {
              console.warn('PandaZap: failed to update note tags', e);
            }
          }
        }
        this.noteCache = null;
        return { status: 'updated' };
      }

      return { status: 'missing' };
    } catch (e: unknown) {
      console.warn('PandaZap: updateExistingCard failed', e);
      return { status: 'missing' };
    }
  }

  private async uploadImageToAnki(imagePath: string, notePath: string): Promise<string | null> {
    const source = resolveImageSource(this.app, imagePath, notePath);
    if (!source) return null;

    let base64 = '';
    let filename = '';

    if (typeof source === 'string') {
      base64 = await downloadImageToBase64(source);
      filename = getImageFilename(source);
    } else if (source instanceof TFile) {
      base64 = await readImageFileToBase64(this.app, source);
      filename = source.name || getImageFilename(source.path);
    } else {
      return null;
    }

    const safeFilename = sanitizeMediaFilename(filename, notePath);

    const result = (await this.ankiConnectRequest('storeMediaFile', 6, {
      filename: safeFilename,
      data: base64,
    })) as string;
    return result;
  }

  private async prefetchNotesForDeck(deckName: string): Promise<void> {
    if (this.noteCache && this.noteCache.deckName === deckName) return;
    this.noteCache = { deckName, byFront: new Map(), noteIds: [] };

    try {
      const query = `deck:"${deckName}" tag:${PLUGIN_TAG}`;
      let noteIds: string[] = [];
      try {
        noteIds = (await this.ankiConnectRequest('findNotes', 6, { query })) as string[];
      } catch (e: unknown) {
        console.warn('PandaZap: prefetch tag-scoped query failed', e);
      }

      if (!noteIds || noteIds.length === 0) {
        return;
      }

      const notesInfo = (await this.ankiConnectRequest('notesInfo', 6, { notes: noteIds })) as AnkiNoteInfo[];
      if (!notesInfo || !Array.isArray(notesInfo)) return;

      for (const ni of notesInfo) {
        try {
          const frontValue = ni.fields?.Front?.value ?? '';
          const front = frontValue.trim();
          const key = normalizeField(front);
          const id = ni.noteId ?? ni.noteIds?.[0] ?? ni.id ?? '';
          this.noteCache.noteIds.push(id);
          const entry: NoteCacheEntry = { noteId: id, fields: ni.fields, raw: ni };
          const existing = this.noteCache.byFront.get(key);
          if (existing) {
            existing.push(entry);
          } else {
            this.noteCache.byFront.set(key, [entry]);
          }
        } catch (e: unknown) {
          console.warn('PandaZap: error caching note', e);
        }
      }
    } catch (e: unknown) {
      console.warn('PandaZap: prefetchNotesForDeck failed', e);
      this.noteCache = null;
    }
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
    if (noteContent && this.settings.deckOverrideWord) {
      const firstLine = noteContent.split(/\r?\n/)[0] || '';
      const esc = this.settings.deckOverrideWord.replace(/[.*+?^${}(|[\]\\]/g, '\\$&');
      const prefRegex = new RegExp(`^${esc}::\\s*(.+)$`, 'i');
      const m = firstLine.match(prefRegex);
      if (m?.[1]) {
        return m[1].trim().replace(/\//g, '::');
      }
    }

    if (!this.settings.useNoteBased || !notePath) {
      return this.settings.defaultDeck;
    }

    return this.getDeckNameFromPath(notePath);
  }

  private getSourceTag(notePath: string): string {
    const s = notePath.replace(/[/\\]/g, '_').replace(/[\s,]+/g, '_');
    const prefix = SOURCE_TAG_PREFIX;
    const maxLen = 80;
    const tag = `${prefix}${s}`;
    if (tag.length <= maxLen) return tag;
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = ((hash << 5) - hash) + s.charCodeAt(i);
      hash |= 0;
    }
    const hashStr = Math.abs(hash).toString(36);
    const keepLen = maxLen - prefix.length - hashStr.length - 1;
    return `${prefix}${s.slice(0, keepLen)}_${hashStr}`;
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
    return new Promise((resolve) => activeWindow.setTimeout(resolve, ms));
  }

  private async ankiConnectRequest(
    action: string,
    version: number,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    const url = this.buildAnkiConnectUrl();
    const body = JSON.stringify({ action, version, params });

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

        const data = response.json as AnkiConnectResponse;
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

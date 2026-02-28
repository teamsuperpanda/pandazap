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
import { ANKI_CONNECT_VERSION, PLUGIN_TAG } from '../constants';
import {
  resolveImageSource,
  readImageFileToBase64,
  downloadImageToBase64,
  getImageFilename,
} from './imageUtils';

export class AnkiConnector {
  private settings: PandaZapSettings;
  private app: App;
  // Simple cache for notes info per-deck to avoid per-card findNotes calls
  private noteCache: {
    deckName: string;
    byFront: Map<string, NoteCacheEntry>;
    noteIds: string[];
  } | null = null;

  constructor(settings: PandaZapSettings, app: App) {
    this.settings = settings;
    this.app = app;
  }

  /**
   * Tests connection to Anki Connect
   * @returns Promise<boolean> True if connection successful
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.ankiConnectRequest('version', ANKI_CONNECT_VERSION);
      return response !== null;
    } catch {
      return false;
    }
  }

  /**
   * Analyzes what sync operations need to be performed
   * @param cards Array of cards to analyze
   * @param notePath Optional path to the note file
   * @param noteContent Optional content of the note
   * @returns Promise<SyncAnalysis> Analysis of required operations
   */
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
        const existingCardId = await this.findExistingCard(card, deckName);

        if (existingCardId) {
          // Fetch note info to compare fields — only mark for update if Front or Back changed
          try {
            const infoResult = (await this.ankiConnectRequest('notesInfo', ANKI_CONNECT_VERSION, {
              notes: [existingCardId],
            })) as AnkiNoteInfo[];
            const ni = infoResult?.[0];
            const front = (ni?.fields?.Front?.value ?? '').trim();
            const back = (ni?.fields?.Back?.value ?? '').trim();
            const qTrim = (card.question || '').trim();

            let match = false;
            // Normalize front/back for comparison
            // Anki might wrap content in <div> or have different whitespace

            if (front === qTrim) {
              if (card.image) {
                // Heuristic: if card has image, check if Back contains filename (raw or encoded)
                // If the answer is present, it must be in the back field.
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
                // No image: Strict equality
                const aTrim = (card.answer || '').trim();
                if (back === aTrim) {
                  match = true;
                }
              }
            }

            if (match) {
              // No change — skip
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
          } catch {
            // If we can't fetch note info, be conservative and schedule an update
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
      } catch {
        // Silently skip cards with analysis errors
        analysis.cardsToAdd.push({
          card,
          action: CardAction.ADD,
          deckName,
        });
      }
    }

    // If using note-based decks, detect Anki notes that were previously created from this note
    // but are no longer present in the current note and mark them for deletion.
    try {
      if (this.settings.useNoteBased && notePath) {
        // Find notes in the target deck that have the plugin tag
        const query = `deck:"${deckName}" tag:${PLUGIN_TAG}`;
        const existingNoteIds = (await this.ankiConnectRequest(
          'findNotes',
          ANKI_CONNECT_VERSION,
          { query }
        )) as string[];
        if (existingNoteIds && existingNoteIds.length > 0) {
          // Fetch note info to read Front/Back fields
          const notesInfo = (await this.ankiConnectRequest('notesInfo', ANKI_CONNECT_VERSION, {
            notes: existingNoteIds,
          })) as AnkiNoteInfo[];
          // Build a set of extracted questions for quick lookup (normalized)
          const extractedQuestions = new Set(cards.map((c) => (c.question || '').trim()));

          for (const ni of notesInfo) {
            try {
              const front = ni.fields?.Front?.value?.trim() ?? '';
              const back = ni.fields?.Back?.value?.trim() ?? '';
              if (front && !extractedQuestions.has(front)) {
                // This card exists in Anki but not in the current note — schedule for deletion
                const delCard = { question: front, answer: back, line: -1 };
                const noteId = ni.noteId ?? ni.noteIds?.[0] ?? ni.id ?? '';
                const cs: CardSyncInfo = {
                  card: delCard,
                  action: CardAction.DELETE,
                  deckName,
                  existingCardId: noteId,
                };
                analysis.cardsToDelete.push(cs);
              }
            } catch {
              // ignore per-note errors
            }
          }
        }
      }
    } catch {
      // Non-fatal: if deletion detection fails, continue without marking deletions
    }

    return analysis;
  }

  private async findExistingCard(card: AnkiCard, deckName: string): Promise<string | null> {
    try {
      // Ensure deck notes are prefetched and cached
      await this.prefetchNotesForDeck(deckName);
      if (this.noteCache?.byFront) {
        const key = this.normalizeField(card.question || '');
        const entry = this.noteCache.byFront.get(key);
        if (entry) return entry.noteId ?? null;
      }
      return null;
    } catch {
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

    if (this.settings.useNoteBased && notePath && !preview) {
      try {
        await this.ankiConnectRequest('createDeck', 6, {
          deck: deckName,
        });
      } catch {
        // ignore deck creation errors
      }
    }

    for (const card of cards) {
      try {
        if (!card.answer && !card.image) {
          results.push(`⚠️ Skipped invalid card (missing answer and image): ${card.question}`);
          continue;
        }

        if (preview) {
          const targetDeck =
            this.settings.useNoteBased && notePath ? deckName : this.settings.defaultDeck;
          const qTag = `${this.settings.questionWord}:`;
          const aTag = `${this.settings.answerWord}:`;
          const iInfo = card.image ? ` | 🖼️ Image: ${card.image}` : '';
          const aInfo = card.answer ? `${card.answer}` : '(image only)';

          results.push(
            `Preview: ${qTag} ${card.question} | ${aTag} ${aInfo}${iInfo} | Deck: ${targetDeck}`
          );
        } else {
          // 1. Handle Image
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
              results.push(`⚠️ Image failed (${card.image}): ${msg}`);
              // Continue sync with text only
            }
          }

          const updateStatus = await this.updateExistingCard(card, deckName, finalBack);

          if (updateStatus.status === 'updated') {
            results.push(`🔄 Updated: ${card.question} → ${deckName}`);
          } else if (updateStatus.status === 'identical') {
            results.push(`ℹ️ Skipped (already up-to-date): ${card.question} → ${deckName}`);
          } else {
            // not found or error, try adding
            try {
              await this.ankiConnectRequest('addNote', 6, {
                note: {
                  deckName: deckName,
                  modelName: this.settings.noteType,
                  fields: {
                    Front: card.question,
                    Back: finalBack,
                  },
                  tags: ['panda-zap', 'obsidian'],
                },
              });
              results.push(`✅ Added: ${card.question} → ${deckName}`);
            } catch (err: unknown) {
              // If Anki reports the note is a duplicate, treat it as a skip (card already exists)
              const msg = err instanceof Error ? err.message.toLowerCase() : '';
              if (msg.includes('duplicate') || msg.includes('cannot create note')) {
                results.push(`ℹ️ Skipped (already exists): ${card.question} → ${deckName}`);
              } else {
                throw err;
              }
            }
          }
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        results.push(`❌ Failed: ${card.question} - ${msg}`);
      }
    }

    // If deletions are requested (only applicable for note-based decks), and user confirmed them,
    // find deletions via analyzeSyncOperation and delete the notes.
    if (!preview && deleteConfirmed && this.settings.useNoteBased && notePath) {
      try {
        const analysis = await this.analyzeSyncOperation(cards, notePath, noteContent);
        const toDelete = analysis.cardsToDelete
          .map((d) => d.existingCardId)
          .filter((id): id is string => Boolean(id));
        if (toDelete.length > 0) {
          // Call AnkiConnect deleteNotes
          await this.ankiConnectRequest('deleteNotes', 6, { notes: toDelete });
          results.push(`🗑️ Deleted ${toDelete.length} notes from Anki`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        results.push(`❌ Failed to delete notes: ${msg}`);
      }
    }

    return results;
  }

  private async updateExistingCard(
    card: AnkiCard,
    deckName: string,
    backContentOverride?: string
  ): Promise<{ status: 'updated' | 'identical' | 'missing' }> {
    try {
      // Use cached notes when available to avoid extra network calls
      await this.prefetchNotesForDeck(deckName);
      let noteId: string | undefined;
      if (this.noteCache?.byFront) {
        const key = this.normalizeField(card.question || '');
        const entry = this.noteCache.byFront.get(key);
        noteId = entry?.noteId;
      }

      const targetBack = backContentOverride !== undefined ? backContentOverride : card.answer;

      if (noteId) {
        // Use cached fields if available to avoid notesInfo call
        const cached = this.noteCache?.byFront.get(this.normalizeField(card.question || ''));
        try {
          const front = (cached?.fields?.Front?.value ?? '').trim();
          const back = (cached?.fields?.Back?.value ?? '').trim();
          const qTrim = (card.question || '').trim();
          const aTrim = (targetBack || '').trim();

          // Robust check for identical content
          let isIdentical = false;

          if (front === qTrim) {
             if (card.image) {
                // Determine if 'back' effectively matches 'targetBack'
                const filename = getImageFilename(card.image);
                // Variants to check
                const encodedFilename = encodeURI(filename);
                const spaceEncodedFilename = filename.replace(/ /g, '%20');
                const underscoreFilename = filename.replace(/ /g, '_');

                const hasFilename =
                  back.includes(filename) ||
                  back.includes(encodedFilename) ||
                  back.includes(spaceEncodedFilename) ||
                  back.includes(underscoreFilename);

                 // Check if the text part of the answer is present (if any)
                const textPart = card.answer ? card.answer.trim() : '';
                const hasAnswer = !textPart || back.includes(textPart);
                const hasImgTag = back.includes('<img');

                if (hasAnswer && hasImgTag && hasFilename) {
                  isIdentical = true;
                }
             } else {
                 if (back === aTrim) {
                     isIdentical = true;
                 }
             }
          }

          if (isIdentical) {
            return { status: 'identical' };
          }
        } catch {
          // If we can't read cached info, fallthrough and attempt update conservatively
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
        // Invalidate cache if present since we changed a note
        this.noteCache = null;
        return { status: 'updated' };
      }

      return { status: 'missing' };
    } catch {
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

    // Store
    const result = (await this.ankiConnectRequest('storeMediaFile', 6, {
      filename: filename,
      data: base64,
    })) as string;
    return result; // returns filename
  }

  private normalizeField(s: string): string {
    return (s || '').toString().trim();
  }

  private async prefetchNotesForDeck(deckName: string): Promise<void> {
    // If cache is already for this deck, return
    if (this.noteCache && this.noteCache.deckName === deckName) return;
    this.noteCache = { deckName, byFront: new Map(), noteIds: [] };

    try {
      // Prefer plugin-tagged notes to avoid scanning entire deck
      const query = `deck:"${deckName}" tag:${PLUGIN_TAG}`;
      let noteIds: string[] = [];
      try {
        noteIds = (await this.ankiConnectRequest('findNotes', 6, { query })) as string[];
      } catch {
        // ignore and try deck-only
      }

      if (!noteIds || noteIds.length === 0) {
        // Fallback to deck-only query
        try {
          noteIds = (await this.ankiConnectRequest('findNotes', 6, { query: `deck:"${deckName}"` })) as string[];
        } catch {
          noteIds = [];
        }
      }

      if (!noteIds || noteIds.length === 0) return;

      const notesInfo = (await this.ankiConnectRequest('notesInfo', 6, { notes: noteIds })) as AnkiNoteInfo[];
      if (!notesInfo || !Array.isArray(notesInfo)) return;

      for (const ni of notesInfo) {
        try {
          const frontValue = ni.fields?.Front?.value ?? '';
          const front = frontValue.trim();
          const key = this.normalizeField(front);
          const id = ni.noteId ?? ni.noteIds?.[0] ?? ni.id ?? '';
          this.noteCache.noteIds.push(id);
          this.noteCache.byFront.set(key, { noteId: id, fields: ni.fields, raw: ni });
        } catch {
          // ignore individual failures
        }
      }
    } catch {
      // On any failure, clear cache
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
    // Allow a Deck:: override on the first line of the note regardless of "useNoteBased".
    if (noteContent && this.settings.deckOverrideWord) {
      const firstLine = noteContent.split(/\r?\n/)[0] || '';
      // Escape word for safe regex use and require the literal '::' after it
      const esc = this.settings.deckOverrideWord.replace(/[.*+?^${}(|[\]\\]/g, '\\$&');
      const prefRegex = new RegExp(`^${esc}::\\s*(.+)$`, 'i');
      const m = firstLine.match(prefRegex);
      if (m?.[1]) {
        // Normalize any '/' to Anki's '::' nested-deck separator
        return m[1].trim().replace(/\//g, '::');
      }
    }

    if (!this.settings.useNoteBased || !notePath) {
      return this.settings.defaultDeck;
    }

    return this.getDeckNameFromPath(notePath);
  }
  private buildAnkiConnectUrl(): string {
    // Normalize URL + port. settings.ankiConnectUrl may include protocol and/or port.
    try {
      const maybeUrl = String(this.settings.ankiConnectUrl || 'http://127.0.0.1');
      let u: URL;
      try {
        u = new URL(maybeUrl);
      } catch {
        // If the URL is missing protocol, prepend http://
        u = new URL(`http://${maybeUrl}`);
      }
      if ((!u.port || u.port === '') && this.settings.ankiConnectPort) {
        u.port = String(this.settings.ankiConnectPort);
      }
      return u.toString();
    } catch {
      // Fallback
      return `http://127.0.0.1:${this.settings.ankiConnectPort || 8765}`;
    }
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
          const backoff = 200 * Math.pow(2, attempt);
          await this.sleep(backoff + Math.random() * 150);
          continue;
        }
        throw error;
      }
    }
  }
}

/**
 * dsh-quote-followup host half (TUI face) — type surface.
 * @module dsh-quote-followup
 */
import type { Context } from '@deepseek-ai/cordis';

/** One quoted message. */
export interface QuoteEntry {
    seq: number;
    role: 'user' | 'assistant';
    text: string;
}

/** Row config (all optional; see cordis.patch.yml). */
export interface QuoteFollowupConfig {
    /** Global combo for the picker (needs ctrl or alt). Default 'ctrl+alt+q'. */
    shortcut?: string;
    /** Picker rows shown, newest first. Default 30. */
    pickerLimit?: number;
    /** Per-quote character cap. Default 1600. */
    quoteMaxChars?: number;
}

/** Clip a string to `max` cells with an ellipsis marker. */
export declare function clip(text: string, max: number): string;

/** Project one `session/event` record onto a bufferable message (or null). */
export declare function extractMessage(session: { id: string } | null, event: {
    type?: string;
    seq?: number;
    data?: unknown;
}): (QuoteEntry & { sessionId: string }) | null;

/** Compose the quote block appended into the prompt input. */
export declare function frameQuotes(quotes: QuoteEntry[], quoteMaxChars?: number): string;

export declare const name: string;
export declare const inject: string[];

export declare function apply(ctx: Context, config?: QuoteFollowupConfig): void;

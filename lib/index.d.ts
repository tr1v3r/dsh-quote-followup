/**
 * dsh-quote-followup host half (TUI face) — type surface.
 * @module dsh-quote-followup
 */
import type { Context } from '@deepseek-ai/cordis';

/** One quoted message (`seq: null` marks a mouse-selection/clipboard quote). */
export interface QuoteEntry {
    seq: number | null;
    role: 'user' | 'assistant' | '划选';
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
    /** Custom clipboard reader (`/bin/sh -c`; defaults to pbpaste / wl-paste /
     *  xclip / xsel probing). */
    clipboardReadCommand?: string;
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

/** Read the system clipboard ('' on failure / unsupported platform). */
export declare function readClipboard(overrideCommand?: string): Promise<string>;

export declare const name: string;
export declare const inject: string[];

export declare function apply(ctx: Context, config?: QuoteFollowupConfig): void;

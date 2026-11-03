export declare function scrubMessage(message: string): string;
/** The stack with the scrubbed message as its first line (the original repeats the message) and the frames as they are. */
export declare function scrubStack(err: Error): string | null;
/** `{ type, message }` of anything thrown. A non-Error is `NonError` with its string form as the message. */
export declare function describeError(err: unknown): {
    type: string;
    message: string;
};

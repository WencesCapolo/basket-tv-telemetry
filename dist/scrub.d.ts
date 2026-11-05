export declare function scrubMessage(message: string): string;
/** The stack with the scrubbed message as its first line (the original repeats the message) and the frames as they are. */
export declare function scrubStack(err: Error): string | null;
export interface ErrorDescription {
    type: string;
    message: string;
    /** An Error's Error `cause`, one level only: a failed query's message is mostly SQL, its cause says why. */
    cause?: {
        type: string;
        message: string;
    };
}
/**
 * `{ type, message, cause? }` of anything thrown. A non-Error is `NonError` with its string form as the message.
 * Never throws: it runs in the wrappers' catch, where a throw would replace the original error.
 */
export declare function describeError(err: unknown): ErrorDescription;

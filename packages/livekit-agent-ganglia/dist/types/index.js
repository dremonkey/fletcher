/**
 * Error thrown when authentication fails.
 */
export class AuthenticationError extends Error {
    code;
    statusCode;
    constructor(message, code, statusCode) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.name = 'AuthenticationError';
    }
}
/**
 * Error thrown when session is invalid or expired.
 */
export class SessionError extends Error {
    sessionId;
    reason;
    constructor(message, sessionId, reason) {
        super(message);
        this.sessionId = sessionId;
        this.reason = reason;
        this.name = 'SessionError';
    }
}

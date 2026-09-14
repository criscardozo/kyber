// One error type for "the consumer got something wrong", so scripts can print
// the message on its own and exit 1, instead of a stack trace pointing into
// kyber for a problem that lives in `.kyber/config.json` or the environment.

export class KyberError extends Error {
  constructor(message) {
    super(message);
    this.name = "KyberError";
  }
}

/**
 * Run a script's `main`, translating failures into exit codes.
 *
 * A KyberError is a message for the person at the keyboard; anything else is a
 * bug or a network failure and keeps its stack.
 */
export function run(main) {
  main().catch((error) => {
    if (error instanceof KyberError) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exit(1);
  });
}

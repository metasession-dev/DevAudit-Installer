/**
 * An option the install refuses before it changes anything: an unknown `--preset`, a preset that needs
 * a portal feature the portal does not have, an unreadable `--from-scan` file. The command prints the
 * message and exits with `exitCode` (2), not the generic failure code (1).
 */
export class InstallRefusal extends Error {
  readonly exitCode = 2;
  constructor(message: string) {
    super(message);
    this.name = 'InstallRefusal';
  }
}

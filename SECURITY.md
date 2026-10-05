# Security

## Report a vulnerability

Use [GitHub’s private vulnerability reporting](https://github.com/ShortTimeNoSee/ZotStop/security/advisories/new). Please do not post exploit details, credentials, or rider information in a public issue.

Include the affected version or commit, the component involved, steps to reproduce, expected behavior, actual behavior, and potential impact. Use synthetic data whenever possible. Remove personal locations and identifying information from attached logs.

Only the latest published release and the current main branch receive fixes. There is no guaranteed response time. The maintainer will review reports and coordinate a fix and disclosure with the reporter where possible.

## Relevant boundaries

- Location stays on the device unless ride sharing is explicitly enabled.
- Rider hints are unverified. Multiple sessions must not be treated as proof of independent people or used to replace official arrival estimates.
- Client validation is not a security boundary. The relay validates submitted reports and limits accepted sessions.
- Release signing credentials are kept outside the repository. Development APKs and official release APKs use different signing keys.

See [Privacy](PRIVACY.md) for transmitted data and retention. Ordinary bugs and accessibility problems belong in [Issues](https://github.com/ShortTimeNoSee/ZotStop/issues).

# Security Policy

## Supported Versions

Files MD is an open-source project maintained on a best-effort basis.

Security updates are generally provided for the latest stable release. Older releases may not receive security patches, and users are encouraged to keep their installations updated.

| Version | Supported |
| ------- | --------- |
| Latest stable release | :white_check_mark: |
| Previous releases | :x: |
| Development / unreleased | Best effort |

Support status may change as new versions are released.

## Reporting a Vulnerability

The security of Files MD is important. If you discover a potential security vulnerability, please report it responsibly.

**Do not disclose security vulnerabilities through public GitHub issues, pull requests, or discussions before the maintainer has had an opportunity to investigate.**

### How to Report

Please submit vulnerability reports using GitHub's private vulnerability reporting feature:

**[Report a Security Vulnerability](https://github.com/garrettds11/files-md/security/advisories/new)**

If private vulnerability reporting is unavailable, please contact the repository maintainer through an appropriate private communication channel.

When submitting a report, include as much of the following information as possible:

- **Description:** A clear explanation of the vulnerability.
- **Affected components:** Relevant files, features, or dependencies.
- **Affected versions:** Versions or commits where the vulnerability exists.
- **Steps to reproduce:** Instructions for reproducing the issue.
- **Proof of concept:** Example inputs, screenshots, or code demonstrating the vulnerability, where appropriate.
- **Potential impact:** The security implications and possible exploitation scenarios.
- **Suggested remediation:** Any recommended fixes or mitigations.

Please avoid including sensitive information, credentials, or personal data in vulnerability reports.

## Vulnerability Response Process

Security reports will be handled according to the following general process.

| Stage | Expected Action |
| ----- | --------------- |
| Acknowledgment | The maintainer will attempt to acknowledge the report within 7 calendar days. |
| Initial assessment | The reported vulnerability will be reviewed to determine validity, severity, and potential impact. |
| Investigation | Confirmed vulnerabilities will be investigated and prioritized based on their security implications. |
| Remediation | Fixes or mitigations will be developed when feasible. |
| Disclosure | Confirmed vulnerabilities may be documented through GitHub Security Advisories or release notes. |

These timelines are targets rather than guaranteed service-level agreements. Response and remediation times may vary depending on maintainer availability and the complexity of the issue.

### Accepted Reports

If a vulnerability is confirmed, the maintainer may:

1. Coordinate with the reporter to validate the findings.
2. Develop and test an appropriate fix or mitigation.
3. Release a security update when feasible.
4. Publish a GitHub Security Advisory describing the vulnerability and remediation.
5. Credit the reporter, if requested and appropriate.

### Declined Reports

Reports may be declined if the issue:

- Cannot be reproduced with the information provided.
- Does not represent a security vulnerability.
- Affects an unsupported version without affecting the current release.
- Concerns functionality outside the project's security scope.
- Has already been reported and is under investigation.

Where practical, the maintainer will provide an explanation for declined reports.

## Coordinated Disclosure

Reporters are encouraged to allow reasonable time for investigation and remediation before publicly disclosing vulnerability details.

Please coordinate public disclosure with the maintainer to reduce the risk of exploitation before affected users have an opportunity to apply available fixes.

No specific remediation or disclosure deadline is guaranteed.

## Security Best Practices

Users and contributors are encouraged to:

- Use the latest stable release.
- Review third-party dependencies before introducing them into the project.
- Avoid storing credentials, access tokens, or sensitive information in project files.
- Exercise caution when opening or importing untrusted files.
- Review changes before deploying the project in sensitive environments.
- Report suspected vulnerabilities through the private reporting process.

## Scope and Limitations

Files MD is provided on an "AS IS" basis, without warranties or guarantees of security.

The project does not guarantee that all vulnerabilities will be identified or remediated. Users are responsible for evaluating the suitability of the software for their own environments and security requirements.

For additional information regarding warranties and liability, refer to the repository's LICENSE file.

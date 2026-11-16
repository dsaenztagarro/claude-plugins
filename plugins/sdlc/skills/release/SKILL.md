---
name: release
description: "Cut a release of merged work: version from the Conventional Commit types since the last tag, a CHANGELOG entry, and an annotated tag. Use when an epic closes, or when asked to release, tag, version or ship what is on the default branch."
argument-hint: "[major|minor|patch]"
---

# Cut a release

A release records work that already merged with its own issues and pull requests.
It opens no issue and applies no labels: the entry cites those pull requests, and that is the record.
Deploying stays with the user.

## 1. Find what is unreleased

- `git switch <default> && git pull`, then `git describe --tags --abbrev=0` for the last tag.
- `git log --format='%h %s' <last-tag>..HEAD` lists the merged pull requests.
- **Stop when there is nothing to cut:** no commits since the tag, or `HEAD` already tagged.

## 2. Choose the version

- A breaking change (`!` or `BREAKING CHANGE:`) is `major`, or `minor` before 1.0.
- Only `fix` commits is `patch`.
- Anything else is `minor`.
- A bump the user names wins.
- Update the version file when the project has one (`version.rb`, `package.json`, `VERSION`); otherwise the tag is the version.

## 3. Write the CHANGELOG entry

- Copy the shape of the entry above it: headline, section names, link style, date format, the compare link at the foot.
  Without a `CHANGELOG.md`, start one in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) form.
- Write each item as the outcome a user sees, and cite its pull request.
  Fold the commits of one change into one item.
- Leave out what changes nothing for a reader of the release: merge commits, a previous release commit, CI tuning nobody notices.

## 4. Land it

- **Where the project's agent instructions allow direct commits to the default branch**, commit there: `chore(release): v<version>`.
- **Otherwise** branch `release/v<version>`, commit, `gh pr create` with the entry as its body, and squash-merge it.
- **Run no gate for a commit that touches only the CHANGELOG and the version file.** The code is the tree the default branch already passed. Run the project's gate only if the release commit changes anything else.

## 5. Tag

- On the default branch, tag the release commit: `git tag -a v<version> -F <message-file>`, then `git push origin v<version>`.
- The message is `Release v<version>`, a blank line, then the entry below its version heading as plain text: headings without `#`, no bold or code marks, each link reduced to its text.
- A GitHub release comes from the project's release workflow when it has one; otherwise `gh release create v<version> --notes-from-tag`.

## 6. Report

Give the version and the one before it, the release PR or commit, and the tag.
End with the project's deploy command for the user to run, if it has one; never run it.

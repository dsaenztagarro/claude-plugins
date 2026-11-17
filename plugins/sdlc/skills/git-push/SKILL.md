---
name: git-push
description: "Push local commits with `git pull --rebase` first, resolving or aborting on conflict and never forcing past a refusal. Use before every `git push`, in any repository."
---

# Push with a rebase first

1. **Rebase onto the remote.**
   Run `git pull --rebase`; success is `Current branch … is up to date` or `Successfully rebased and updated …`.
   It replays only the unpushed commits on top of the remote, so history stays linear and no published SHA changes.
   Do it even where `pull.rebase` is `false`: that setting governs a bare `git pull`, and the rebase leaves published commits alone.
2. **If the rebase stops:**
   - A conflict where both sides are understood: resolve it, `git add`, `git rebase --continue`, then rerun the project's gate, because the replayed commits are new code.
   - Anything else: `git rebase --abort` and ask the user.
   - Uncommitted changes in the way: commit or stash them; never discard them.
3. **Push** with `git push`.
   - Never `--force` past a refusal on a shared branch; a refusal after the rebase means the remote moved again, so repeat step 1.
   - Force only a branch nobody else has fetched, such as your own PR branch after a requested rebase, and then with `--force-with-lease`.
   - Never `--no-verify`; fix what the hook reports.
4. **Report** what the pull did (up to date, or the commits it rebased over) and the range the push moved (`a0f4daa..96fcaa9`).

# Rebuild the runs a pause note lists

Read by `/sdlc:resume` when the pause note has a **Runs** line.
The paused runs are gone. What survives is their branches, their pull requests and the relaunch line, and this machine may never have seen any of them.

1. **Fetch,** then rebuild a worktree for every branch the note names that has no worktree here: `git fetch origin`, then `git worktree add .claude/worktrees/<b> <b>`. Git creates the local branch tracking `origin/<b>`. Never cut a branch the note names afresh: that discards the commits on it.
2. **Check that each relaunch exists here:** the workflow script is at its path. When it is not, the next action is installing the plugin or fetching the repository that holds the script, not relaunching.
3. **Classify each run** by its pull request:
   - **Merged:** its next step is the close run on the default branch.
   - **Open:** run the gate on its branch, then merge it.
   - **None:** relaunch it with the recorded args. A batch script continues from the branch: it skips tickets already integrated, and resumes each ticket branch from its commits, folding any `WIP:` commit into the ticket's real one.
4. **Confirm before relaunching anything.** A run costs real time and tokens. Brief first, and relaunch the runs the user names, in the note's order, in one message.
   Runs that share no branch may go in parallel; a run whose branch descends from another's waits for that one's merge.

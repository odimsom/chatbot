---
description: commit and push changes to git
---

// turbo-all

1. Show current git status to see what changed:
```
git -C d:\fcastro\chatbot status
```

2. Stage all changes:
```
git -C d:\fcastro\chatbot add -A
```

3. Review the diff of what's staged:
```
git -C d:\fcastro\chatbot diff --cached --stat
```

4. Commit with a descriptive message (adjust message as needed based on changes):
```
git -C d:\fcastro\chatbot commit -m "chore: update and format code"
```

5. Push to remote:
```
git -C d:\fcastro\chatbot push
```

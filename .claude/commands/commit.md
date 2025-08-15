# commit

Auto-commits all changes with an automatic descriptive message.

```bash
# Stage all changes
cd /home/jason/projects/tinybrush && git add -A

# Check if there are changes to commit
if git diff --cached --quiet; then
    echo "📭 No changes to commit"
else
    # Generate commit message based on changes
    FILES_CHANGED=$(git diff --cached --numstat | wc -l)
    FILES_LIST=$(git diff --cached --name-only | head -5)
    
    # Create automatic commit message
    if [ "$FILES_CHANGED" -eq 1 ]; then
        MESSAGE="Update $(git diff --cached --name-only)"
    elif [ "$FILES_CHANGED" -le 5 ]; then
        MESSAGE="Update multiple files: $(git diff --cached --name-only | xargs basename -a | tr '\n' ', ' | sed 's/,$//')"
    else
        MESSAGE="Update $FILES_CHANGED files across the project"
    fi
    
    # Commit with the auto-generated message
    git commit -m "$MESSAGE" -m "Auto-committed changes via /commit command"
    
    echo "✅ Changes committed: $MESSAGE"
    echo "📝 Files changed: $FILES_CHANGED"
fi
```
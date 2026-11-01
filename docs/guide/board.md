English · [Português](../pt-BR/guia/quadro.md)

# Board

The **Board** (sidebar › Overview › Board) shows your workspaces as cards in columns. Drag a card to another column to change its status. The columns are yours to edit, and a workspace linked to a Linear or GitHub issue can keep that issue's status in step with the card.

## Settings

The gear button in the Board header opens the settings popover. The selector next to it picks the scope:

- **All repositories**: the global board, used by every repository that does not have its own.
- **A repository**: turn on **Own columns** to give it a separate board. With it off, the repository inherits the global board.

Then:

- **Sync board and issue status** (off by default): moving a linked workspace updates its issue when the column has a matching workflow state.
- **Bring changes from the tracker**: when the issue changes outside Kabul, the card follows. Kabul checks every 90 seconds and only acts when the issue's `updatedAt` changed (Linear asks for all issues in one request). The first check of an issue only records where it is, so turning this on never shuffles cards. Webhooks may replace polling later.
- **GitHub Projects**: also update the **Status** field of the issue's project (Projects v2, through `gh api graphql`). It needs the `project` scope: `gh auth refresh -s project`.

## Columns

Each column has an icon and a color (picked from a fixed set that works in light and dark themes) and a name you can edit. Reorder with the up and down buttons or by dragging; **+ Add status** creates a new one. Deleting a column that still has cards asks where to move them first.

The default columns are **Todo**, **In progress**, **In review** and **Done**. Boards from earlier versions are migrated (`state.json` v1 → v2, with a `state.json.v1.bak` backup): the old statuses become these columns, and if any workspace was *canceled*, a **Canceled** column is added so nothing is lost.

## Mapping columns to the tracker

Each column maps to a state in each tracker:

1. **Same name** first, with English and Portuguese synonyms (`Todo` = `To do` = `A fazer`, `In review` = `Em revisão`, `Done` = `Concluído`…).
2. Otherwise **the column type**, which the icon tells: to do, in progress, in review, done, canceled.
   - **Linear**: matched against the team's `state.type` (`backlog`, `unstarted`, `started`, `completed`, `canceled`). A review column on a team without a review state falls back to *In Progress*.
   - **GitHub Issues**: done → closed, canceled → closed as *not planned*, anything else → open. A column can also have an optional **label**: the issue gets it when it enters the column and loses it when it leaves.
   - **GitHub Projects**: the option of the **Status** field with the same name or type.

Every column can override the result per tracker: **Automatic**, **Never sync** or a specific state (under **Mapping**, below the column name). The popover shows what each column maps to, and **no match** when there is nothing to update; the card still moves, only the issue stays as it is.

## Moving a card

When sync is on, dropping a linked card shows the result, for example "ENG-12 → In Progress in Linear", with **Undo**: it puts the card back and restores the issue to exactly the state, labels and project status it had before. If the tracker refuses (no permission, network error), the error stays visible with **Retry** and **Undo**.

### Linking an issue

Workspaces created from a Linear issue (⌘K palette › "New workspace from a Linear issue") are already linked. For any other workspace, use the link button on its card and paste one of:

- a GitHub issue URL or `owner/repo#12`;
- `#12` (an issue in the workspace's repository);
- a Linear issue URL or identifier, such as `ENG-12`.

Leave it empty to unlink.

## Moving by itself

The board can move cards when something happens in Kabul. By default:

| Event | Column |
| --- | --- |
| An agent starts working | In progress |
| A pull request is opened | In review |
| The pull request is merged | Done |

Pick another column or **Don't move** for each event, or turn them all off. Automatic moves only go forward: a card already in review is not sent back to *In progress* when you send the agent another message. When sync is on, the issue follows these moves too.

## Security and permissions

- The Linear key stays in the system vault (Keychain / Credential Manager / Secret Service) and only travels in the HTTPS header. GitHub goes through the `gh` sign-in. No token is ever put on a command line or in a log.
- Only the owner changes the board, moves cards or links issues. Guests connected through kabuld can only read the columns.
- On the phone, workspace statuses show the column names of the board.

## For developers

Trackers sit behind the `IssueTracker` layer in `crates/kabul-core/src/tracker` (Linear and GitHub today). Adding Jira or GitLab means one more `TrackerKind`, an implementation of the trait (with its transport behind a trait so tests can replay recorded responses) and registering it in `Trackers::real`. Column mapping (`crates/kabul-core/src/board.rs`) only sees state names and types, so it works the same for every tracker.

# Comparing my Interface to the Reference Interface

## One design you retained from the reference interface.
the callouts for comments to show to the right. this made sense as a starting point for annotation, like editing in the margins of a paper.

## One design you changed after inspecting your traces.
I did two major design changes that deeply impacted the navigation and relative layout of information. First, I grouped the UI to organize by sessions/threads and not as individual traces. This makes the data structure of the UI a bit more complicated but allows me to more effectively view the important chain of related events in the human-to-agent interaction. The tool calls were reorganized into clearly accessible subset of an agent's response, listed right before the agent gives their comment back to the user. Each tool call comes with a small agent comment, so this is included as well and is infinitely easier to read. As a bonus, I pulled out the Thinking information to get the agents words on its approach which could help explain the use of each tools. This allows us for each turn to see clearly how the agent was working.

## One limitation remaining in your interface.
The commenting can only apply to messages, not tool calls or other trace information. I also have not implemented any find/filter capabilities beyond scenario name matching. I expect version info for model or prompt as well as other stats (# turns, pass/fail/unreviewed) to be critical filtering needs soon. In addition, the layout and interaction of exploring the Thinking and Tool Calls in the interface is passable but quite clunky; it should be improved when more time is spent on the UI.

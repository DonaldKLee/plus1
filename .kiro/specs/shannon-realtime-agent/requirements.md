# Requirements Document

## Introduction

Shannon is the plus1 agent that joins a Google Meet call as a visible participant with a face, a
voice, and the ability to run tools on the user's behalf. Today the character is named "Bob" and every
response costs roughly four seconds: a transcription-only Gemini Live socket seals a line after a
silence gap, a debounce timer fires, a stateless model call decides what to do, a second stateless
model call phrases any tool result, and only then does speech synthesis and avatar playback begin.
Humans answer in 200–500 ms, so at four seconds Shannon reads as a machine regardless of how good the
words are.

This feature does four things. It renames the character to **Shannon** everywhere a person can see or
address her. It replaces the transcribe → gate → decide → narrate → speak pipeline with **one
persistent Live API session** that performs turn detection, reasoning, and native function calling
over a single socket. It makes the source of Shannon's speech audio a **swappable voice path** —
either the model's own native audio or ElevenLabs synthesis — both of which terminate at the same
avatar rig, so the face and lip-sync work identically on either. And it delivers the operator's
already-collected **statement of what the meeting is for** into Shannon's instruction as a standing
briefing, so she joins knowing the objective rather than inferring it from the first few turns.

The two user-stated goals are that Shannon **takes action when necessary** and is **as human as
possible: fast, active, and real time**. Latency and interruption behaviour are therefore first-class
requirements, not optimizations. Equally first-class is that nothing already working regresses in
order to get speed: slot filling, standing memory, muted mode, the Meet chat fallback, the operator
event stream, MongoDB persistence, and the durable avatar utterance all survive unchanged in
observable behaviour.

The legacy pipeline remains selectable behind a flag for the whole of this change, and remains the
resolved default until the rollout gate of Requirement 16 is satisfied, so a regression in a live
customer meeting is recoverable by an environment variable rather than a deployment.

### Out of scope

The following were considered and are explicitly excluded. They are recorded here so that later work
does not reintroduce them as oversights.

- **No relevance gate backed by a search engine.** Routing transcript lines through Elasticsearch to
  decide which reach the model was proposed and rejected: lexical scoring (BM25) measures textual
  similarity, not whether a line is addressed to Shannon, which is a classification problem. It would
  add a network hop to reproduce what a zero-cost local regex already does, on the one path where
  latency is the entire point. Under a continuously streaming Live session there is no per-line model
  call left to suppress, so the gate is unnecessary as a service and survives only as a local hint.
- **No retrieval on the critical path.** Grounding over past meetings and domain documents is a real
  but separate feature. If built, it is a tool the model may choose to call; it is never a
  precondition for responding.
- **No hybrid voice within one meeting.** Changing voice mid-conversation is audible and doubles the
  state machine. The voice is chosen once per session and held for the session.
- **No rebuild of the tool execution layer.** Tool behaviour and authorization are reused as they are.

## Glossary

- **Shannon_Agent**: The complete agent participant in a meeting — face, voice, transcript, and tools.
  Used where a requirement is about externally observable agent behaviour rather than one component.
- **Live_Session**: A single persistent bidirectional Live API socket to a reasoning-capable live
  model. Accepts streaming room audio, performs its own end-of-turn detection, and returns speech
  audio or text, transcriptions, and function call requests. Holds conversation history internally.
- **Session_Runner**: The backend component that owns one meeting: browser automation, audio capture,
  the Live_Session, the Avatar_Rig, persistence, and the Operator_Event_Stream.
- **Voice_Path**: The interchangeable component that converts one turn of Live_Session output into
  24 kHz mono signed 16-bit little-endian PCM delivered to the Avatar_Rig. Exactly one Voice_Path is
  active per session.
- **Native_Audio_Path**: The Voice_Path that relays the live model's own audio output to the
  Avatar_Rig without any separate synthesis step.
- **ElevenLabs_Path**: The Voice_Path that receives the live model's text output, splits it into
  speakable clauses, synthesizes each clause with the ElevenLabs voice, and streams the result to the
  Avatar_Rig.
- **Clause_Assembler**: The component on the ElevenLabs_Path that converts a stream of arbitrary text
  fragments into speakable clauses without splitting words or numbers.
- **Protected_Span**: A run of characters inside which a clause boundary must not fall because
  splitting it would change how the text is spoken — a number including its decimal or thousands
  separators, a currency or measurement amount with its symbol or unit, a dotted abbreviation or
  initialism, and a URL, path, or email address.
- **Avatar_Rig**: The existing component that renders Shannon's animated face into the Meet camera
  feed and plays PCM audio into the Meet microphone bus, with lip-sync. It exposes a durable utterance
  that survives its own upstream session being replaced mid-sentence, and an immediate local mute.
- **Utterance**: One continuous stretch of audio handed to the Avatar_Rig. A new utterance preempts
  whatever is currently playing.
- **Turn**: One cycle of the conversation in which the Live_Session produces output in response to the
  room, ending when the model signals its generation is complete.
- **Qualifying_Turn**: A Turn eligible for a given latency percentile measurement — for the
  no-tool-call budgets, a Turn that contains no tool call, and in all cases a Turn for which both a
  Latency_Origin signal and a first-audio report from the Avatar_Rig were observed.
- **Latency_Origin**: The reference instant from which a Turn's response latency is measured: the
  local receipt timestamp of the Live_Session's own end-of-user-turn signal for that Turn.
- **Latency_Benchmark_Run**: A measurement sample of at least 100 consecutive Qualifying_Turns of one
  kind, captured in a single continuous session under a fixed Voice_Path and Engine_Flag. Latency
  percentile criteria are evaluated over a completed run, never asserted on an individual Turn.
- **Barge_In**: A human beginning to speak while Shannon is speaking. Barge_In requires Shannon to
  stop immediately and to discard the rest of that turn permanently.
- **Barge_In_Detector**: The component that recognises Barge_In from room transcription and triggers
  the stop.
- **Slot_Filling**: Shannon tracking which pieces of information a task needs, which she has
  collected, and which are still missing, so she can ask for exactly what is absent.
- **Meeting_Purpose**: The operator's free-text statement of what a meeting is for, supplied on the
  join form when the session starts or set later by relabelling the session. It is fixed for the
  session unless the operator changes it, and it is untrusted content that describes an objective. It
  is distinct from the Meeting_State's active task, which the model sets and revises as the work
  progresses.
- **Meeting_State**: The structured record backing Slot_Filling — the active task, collected values,
  missing keys, and completed actions.
- **Standing_Memory**: Durable facts Shannon has been told to remember, carried across turns and
  injected into her instruction.
- **Tool_Executor**: The existing component that runs a tool call and is the authorization boundary.
  No requirement permits authorization to move elsewhere.
- **Tool_Access**: The per-session permission set that determines which tools may run and whether file
  and shell operations are read-only or writable.
- **Function_Call_Request**: A request from the Live_Session, carrying a unique identifier, a tool
  name, and arguments, asking for a tool to be run.
- **Function_Call_Response**: The reply sent back on the same Live_Session carrying the tool's result
  and the identifier it answers.
- **Engine_Flag**: `SHANNON_ENGINE`, selecting `live` (one persistent Live_Session) or `legacy` (the
  existing two-stage pipeline). Governs pipeline risk.
- **Voice_Flag**: `SHANNON_VOICE`, selecting `native` (Native_Audio_Path) or `elevenlabs`
  (ElevenLabs_Path). Governs voice identity.
- **Runtime_Config**: The resolved, validated Engine_Flag and Voice_Flag pair for one session, plus a
  record of any coercion applied. All components read the resolved value, never the raw input.
- **Config_Resolver**: The component that produces Runtime_Config from arbitrary input values.
- **Output_Transcription**: The Live_Session's textual transcription of the audio it generated. On the
  Native_Audio_Path this is the only source of what Shannon said.
- **Conversation_Snapshot**: A bounded summary of a Live_Session's history — recent turns,
  Meeting_State, Standing_Memory, and completed actions — captured so a replacement session can resume
  the conversation.
- **Operator_Event_Stream**: The server-sent event stream the dashboard consumes to show transcript
  lines, decisions, avatar status, state, notes, and now live-session, voice, tool, and latency events.
- **Operator_Note**: A human-readable message emitted on the Operator_Event_Stream to surface a
  condition an operator needs to know about.
- **Wake_Word_Gate**: The local check for whether a transcript line addresses Shannon by name. Under
  this design it informs the instruction and the operator display; it does not gate model calls.

## Requirements

### Requirement 1: Rename the agent to Shannon

**User Story:** As the product owner, I want the agent to be named Shannon everywhere a person can see
or address her, so that the character is coherent and people in a meeting can get her attention by
name.

#### Acceptance Criteria

1. WHERE no name override is configured, THE Shannon_Agent SHALL use `Shannon` as its display name in
   the meeting, the dashboard, and the transcript.
2. WHEN a transcript line contains the token `shannon` in any mix of upper and lower case, delimited
   on both sides by a word boundary, THE Wake_Word_Gate SHALL report the line as addressing the
   Shannon_Agent.
3. WHEN a transcript line contains, delimited on both sides by a word boundary, any member of the
   fixed near-miss set of transcription spellings of the name — `shanon` and `shannen`, matched in any
   letter case — THE Wake_Word_Gate SHALL report the line as addressing the Shannon_Agent.
4. WHEN a transcript line contains the product name `plus1`, or the spoken forms `plus one`,
   `plus-one`, or `plus 1`, in any letter case and delimited on both sides by a word boundary, THE
   Wake_Word_Gate SHALL report the line as addressing the Shannon_Agent.
5. WHERE a name override is configured for a session, WHEN a transcript line contains that configured
   name in any letter case delimited on both sides by a word boundary, THE Wake_Word_Gate SHALL report
   the line as addressing the Shannon_Agent.
6. THE Wake_Word_Gate SHALL match only whole words: IF a name token, near-miss spelling, configured
   name, or product name occurs in a transcript line only as a substring of a longer word with no word
   boundary on both sides, THEN THE Wake_Word_Gate SHALL report the line as not addressing the
   Shannon_Agent.
7. THE Wake_Word_Gate SHALL recognise no spelling outside the set defined in criteria 2 through 5, and
   SHALL apply no edit-distance or other approximate comparison, so that words differing from the name
   by one or more characters but absent from that set — including ordinary English words — do not
   report the line as addressing the Shannon_Agent.
8. WHERE the current name environment variable is absent and the superseded legacy name environment
   variable is present, THE Session_Runner SHALL use the legacy value as the agent name.
9. WHERE both the current and the legacy name environment variables are present, THE Session_Runner
   SHALL use the current variable's value.
10. WHEN a stored meeting document written before this change is read, THE Session_Runner SHALL read
    its agent-line statistics from the legacy field name so that archived meetings continue to display
    correctly.
11. THE Session_Runner SHALL preserve the existing identifiers used for browser media capture — the
    avatar element attribute, the page bridge global, and the exposed audio callback names — unchanged
    by the rename.
12. WHEN the Wake_Word_Gate reports a line as addressing the Shannon_Agent, THE Session_Runner SHALL
    make that fact available to the instruction and to the Operator_Event_Stream, and SHALL neither
    suppress, gate, nor delay any model output on the result of the Wake_Word_Gate.

### Requirement 2: One persistent Live session replaces the two-stage pipeline

**User Story:** As a person in a meeting, I want Shannon to hear the room continuously and answer from
a conversation she remembers, so that she responds like a participant instead of a request-response
service.

#### Acceptance Criteria

1. WHERE the Engine_Flag is `live`, THE Session_Runner SHALL maintain exactly one Live_Session at a
   time for the lifetime of the meeting, carrying room audio, model output, transcriptions, and
   function calls on that one connection, and SHALL at no instant hold more than one open Live_Session
   for that meeting.
2. WHERE the Engine_Flag is `live`, THE Session_Runner SHALL forward each captured room audio frame to
   the Live_Session within 100 milliseconds of capturing it, without waiting for a silence gap, a
   debounce interval, or a relevance check.
3. WHERE the Engine_Flag is `live`, THE Live_Session SHALL determine when a human turn has ended, and
   THE Session_Runner SHALL issue zero reasoning-model requests outside the single Live_Session for
   the duration of the meeting, so that a per-session count of such requests reported on the
   Operator_Event_Stream at meeting end is exactly zero.
4. WHERE the Engine_Flag is `live`, WHEN a tool result is returned to the Live_Session, THE
   Live_Session SHALL phrase the spoken answer within the same Turn, and THE Session_Runner SHALL
   issue zero additional model requests between sending the Function_Call_Response and the
   Live_Session reporting that Turn complete, so that the count of model requests attributable to
   narration for the meeting is exactly zero.
5. WHILE a Live_Session has not yet reported that setup is complete, THE Session_Runner SHALL send no
   audio frame to that Live_Session, SHALL retain at most zero audio frames for later sending, and
   SHALL discard each frame that arrives before setup completes while incrementing a count of
   discarded frames.
6. WHERE the Engine_Flag is `live`, THE Session_Runner SHALL continue to seal transcript lines for
   display and persistence only, and the time at which the Shannon_Agent begins speaking in a Turn
   SHALL not depend on whether any transcript line for that Turn has been sealed.
7. WHEN the Runtime_Config is resolved for a session, THE Session_Runner SHALL emit the effective
   Engine_Flag and Voice_Flag on the Operator_Event_Stream within 1000 milliseconds of resolution.
8. IF a session-level configuration change arrives during a meeting while no Turn is in progress,
   THEN THE Session_Runner SHALL apply it to the Live_Session's instruction before the next Turn
   begins and SHALL not interrupt or restart the Live_Session.
9. IF a session-level configuration change arrives while a Turn is in progress, THEN THE
   Session_Runner SHALL leave that Turn's output unchanged, SHALL retain only the most recent pending
   change, and SHALL apply that pending change to the Live_Session's instruction after the
   Live_Session reports that Turn complete and before the next Turn begins.
10. WHEN a Live_Session reports that setup is complete, THE Session_Runner SHALL emit exactly one
    Operator_Note for that Live_Session carrying the count of audio frames discarded before setup
    completed, and SHALL emit no such note when that count is zero.
11. IF a Live_Session does not report that setup is complete within 10 seconds of the connection
    attempt starting, THEN THE Session_Runner SHALL close that connection, SHALL discard all audio
    frames captured in the interim, and SHALL emit an Operator_Note indicating that setup did not
    complete.

### Requirement 3: Response latency

**User Story:** As a person in a meeting, I want Shannon to start answering within about the time a
human would, so that talking to her does not feel like waiting on a machine.

#### Acceptance Criteria

1. WHERE the Engine_Flag is `live`, THE Shannon_Agent SHALL begin audible speech within 1400
   milliseconds of the Latency_Origin at the 50th percentile of Qualifying_Turns in a
   Latency_Benchmark_Run, where a Qualifying_Turn is a Turn that contains no tool call.
2. WHERE the Engine_Flag is `live`, THE Shannon_Agent SHALL begin audible speech within 2000
   milliseconds of the Latency_Origin at the 95th percentile of Qualifying_Turns in a
   Latency_Benchmark_Run.
3. WHERE the active Voice_Path is the Native_Audio_Path, THE Shannon_Agent SHALL begin audible speech
   within 1200 milliseconds of the Latency_Origin at the 50th percentile of Qualifying_Turns in a
   Latency_Benchmark_Run.
4. WHERE the active Voice_Path is the Native_Audio_Path, THE Native_Audio_Path SHALL receive its first
   audio frame from the Live_Session within 800 milliseconds of the Latency_Origin at the 50th
   percentile of Qualifying_Turns in a Latency_Benchmark_Run, measured at the point the frame is
   handed to the Native_Audio_Path and excluding any buffering the Avatar_Rig applies before playback.
5. WHERE the active Voice_Path is the ElevenLabs_Path, THE Shannon_Agent SHALL begin audible speech
   within 1600 milliseconds of the Latency_Origin at the 50th percentile of Qualifying_Turns in a
   Latency_Benchmark_Run, this budget being inclusive of the ElevenLabs first-byte time and the
   Avatar_Rig first-chunk buffer.
6. WHEN a Turn produces its first audio for the Avatar_Rig, THE Session_Runner SHALL emit a latency
   measurement on the Operator_Event_Stream carrying the elapsed milliseconds from the Latency_Origin,
   the Turn identifier, which Voice_Path produced it, and whether the Turn contained a tool call.
7. WHERE the Engine_Flag is `live`, WHEN a Turn includes a tool call, THE Shannon_Agent SHALL begin
   speaking the tool's answer within 350 milliseconds of the Function_Call_Response being sent, at the
   50th percentile of tool-call Turns in a Latency_Benchmark_Run.
8. THE Session_Runner SHALL introduce no fixed delay between the end of a human turn and the start of
   model output beyond the audio buffering the Avatar_Rig and the active Voice_Path require to play
   without stalling.
9. THE Session_Runner SHALL define the Latency_Origin of a Turn as the local receipt timestamp of the
   Live_Session's own end-of-user-turn signal for that Turn, and SHALL define the audible-speech
   instant as the timestamp at which the Avatar_Rig reports its first audio sample of that Turn as
   played.
10. THE Latency_Benchmark_Run SHALL consist of at least 100 consecutive Turns of the measured kind
    captured in a single continuous session under a fixed Voice_Path and Engine_Flag, and the
    percentile criteria in this requirement SHALL be evaluated only over a completed
    Latency_Benchmark_Run and SHALL NOT be enforced as runtime assertions on individual Turns.
11. IF a Turn produces no Latency_Origin signal or no first-audio report from the Avatar_Rig, THEN THE
    Session_Runner SHALL exclude that Turn from the Latency_Benchmark_Run percentile set, emit an
    event on the Operator_Event_Stream indicating the Turn was unmeasurable and why, and continue the
    session without interrupting audio.

### Requirement 4: Taking action through native function calling

**User Story:** As a person in a meeting, I want Shannon to actually do the thing I asked for — pull a
quote, look something up, read a file — rather than describe what she would do, so that she is useful
in the moment.

#### Acceptance Criteria

1. WHERE the Engine_Flag is `live`, THE Session_Runner SHALL declare to the Live_Session exactly those
   tools the session's Tool_Access permits, as structured function declarations, with no declared name
   that the Tool_Executor cannot dispatch and no dispatchable permitted name omitted.
2. WHEN the Live_Session issues a Function_Call_Request, THE Session_Runner SHALL start running the
   requested tool through the Tool_Executor without waiting for any other Function_Call_Request of the
   same Turn to finish, and SHALL return a Function_Call_Response on the same Live_Session.
3. WHEN the Live_Session issues a Function_Call_Request, THE Session_Runner SHALL send exactly one
   Function_Call_Response carrying that request's identifier, including when the tool is unknown, is
   not permitted, fails, times out, or returns no content.
4. THE Session_Runner SHALL send a result text of at least 1 and at most 600 characters in every
   Function_Call_Response, taking the leading portion when the tool's output is longer.
5. IF the requested tool name is not in the set declared for the session, THEN THE Session_Runner
   SHALL return, within 250 milliseconds of receiving the request, a Function_Call_Response stating
   the tool is unavailable, SHALL not invoke the Tool_Executor, and SHALL emit an Operator_Note.
6. IF the Tool_Executor raises an error, THEN THE Session_Runner SHALL return a Function_Call_Response
   describing the failure in words Shannon can speak, and SHALL leave the Meeting_State unchanged for
   that call.
7. IF no Function_Call_Response has been sent for a Function_Call_Request within 20 seconds of that
   request being received, THEN THE Session_Runner SHALL send a Function_Call_Response for that
   identifier reporting the delay and SHALL emit an Operator_Note, so that the Turn cannot stall
   indefinitely.
8. WHEN a tool runs successfully, THE Session_Runner SHALL append exactly one entry describing the
   call and its outcome to the Meeting_State's completed actions, even when other calls of the same
   Turn are still running.
9. WHERE the Engine_Flag is `live`, THE Session_Runner SHALL instruct the Live_Session to speak a
   short acknowledgement before requesting a tool, SHALL not delay running the tool until that
   acknowledgement occurs, and SHALL record for each tool-calling Turn whether speech was delivered to
   the Avatar_Rig before the Function_Call_Response was sent, so that the acknowledgement rate is
   measurable from the Operator_Event_Stream over a sample of Turns.
10. WHERE the active Voice_Path is the ElevenLabs_Path, IF a Function_Call_Request arrives with no
    preceding speech in the Turn, THEN THE ElevenLabs_Path SHALL play a pre-rendered acknowledgement
    to cover the synthesis delay.
11. WHEN a Function_Call_Request is received and when its Function_Call_Response is sent, THE
    Session_Runner SHALL emit the request identifier, the tool name, arguments, result text, and
    elapsed duration on the Operator_Event_Stream.
12. THE Session_Runner SHALL produce identical tool-calling behaviour and identical results for both
    values of the Voice_Flag.
13. WHEN two or more Function_Call_Requests of the same Turn are outstanding at once, THE
    Session_Runner SHALL send each Function_Call_Response as soon as its own call completes, in any
    order relative to the others, and SHALL send no response carrying an identifier other than the one
    it answers.
14. IF a Function_Call_Request arrives carrying an identifier for which a Function_Call_Response has
    already been sent or a call is still outstanding, THEN THE Session_Runner SHALL send no additional
    Function_Call_Response for that identifier, SHALL not invoke the Tool_Executor again, and SHALL
    emit an Operator_Note.
15. IF a tool completes after a Function_Call_Response has already been sent for its identifier, THEN
    THE Session_Runner SHALL discard that result without sending a second Function_Call_Response,
    SHALL append no entry to the Meeting_State's completed actions for it, and SHALL emit an
    Operator_Note.

### Requirement 5: Tool authorization and shell execution safety

**User Story:** As the user whose machine and accounts Shannon acts on, I want authorization enforced
at the point of execution and shell commands gated behind an explicit confirmation, so that a faster
agent cannot act beyond what I allowed or faster than I can object.

#### Acceptance Criteria

1. THE Tool_Executor SHALL be the sole component that decides whether a requested tool may run, and
   THE Session_Runner SHALL submit every tool request to the Tool_Executor for an allow or refuse
   decision before any effect on files, commands, or external accounts occurs.
2. WHEN the Live_Session requests a tool that the session's Tool_Access does not permit, THE
   Tool_Executor SHALL refuse the call, SHALL perform no part of the requested action, and SHALL
   return a Function_Call_Response indicating that the tool was refused as not permitted for the
   session.
3. THE Tool_Executor SHALL treat the set of function declarations sent to the model as a hint only,
   and SHALL evaluate every tool request against the session's Tool_Access regardless of whether that
   tool was declared to the model.
4. WHERE the session's Tool_Access does not grant write permission, THE Tool_Executor SHALL refuse
   every tool that modifies files or executes commands, including any shell command request, and SHALL
   leave all files and system state unchanged.
5. THE Session_Runner SHALL produce identical Tool_Access allow and refuse decisions for the same tool
   request under both values of the Voice_Flag and both values of the Engine_Flag, and SHALL NOT
   delegate any authorization decision to the model or to the voice path.
6. WHERE shell command execution is permitted, WHEN the Live_Session requests a shell command, THE
   Shannon_Agent SHALL announce, before requesting confirmation, the exact command text to be executed
   including its executable and all arguments, and the directory in which it will run, and SHALL then
   request confirmation for that single command occurrence.
7. THE Session_Runner SHALL treat a confirmation as valid only when it is an unambiguous affirmative
   response from the authenticated user of the session, given either as spoken confirmation on the
   Live_Session or as an explicit confirm action from the operator surface, and SHALL treat silence,
   an ambiguous or partial response, unrelated speech, and any response from any other source as a
   denial.
8. THE Session_Runner SHALL scope each valid confirmation to exactly one announced command occurrence,
   SHALL NOT carry a confirmation forward to any later command, and SHALL NOT accept any blanket or
   session-wide confirmation for shell command execution.
9. IF no valid confirmation is received within 30 seconds of the confirmation request, THEN THE
   Session_Runner SHALL treat the command as denied, SHALL NOT execute it, SHALL leave all files and
   system state unchanged, and SHALL return a Function_Call_Response reporting that the command was
   not run because confirmation was not received.
10. IF a confirmation is denied or expires, THEN THE Session_Runner SHALL return a
    Function_Call_Response reporting that the command was not run, SHALL NOT execute the command, and
    SHALL retain the session so that a subsequent shell command request is handled under criteria 6
    through 9.
11. IF barge-in occurs after a shell command is announced and before a valid confirmation is received,
    THEN THE Session_Runner SHALL discard the pending confirmation, SHALL NOT execute the command, and
    SHALL require a new announcement and a new valid confirmation before that command can execute.
12. WHEN a shell command is requested, THE Session_Runner SHALL emit on the Operator_Event_Stream the
    announced command text before execution, and SHALL emit a subsequent event recording the outcome
    as one of confirmed and executed, denied, expired without confirmation, or discarded due to
    barge-in.
13. THE Session_Runner SHALL open the Live_Session from the backend, and SHALL keep model, voice, and
    avatar credentials out of the browser page.

### Requirement 6: Engine and voice configuration

**User Story:** As an operator, I want the pipeline choice and the voice choice to be two independent
switches with a safe resolution of invalid combinations, so that rolling back the pipeline never
silently changes Shannon's voice and a configuration typo never stops her joining a meeting.

#### Acceptance Criteria

1. THE Config_Resolver SHALL accept the Engine_Flag and the Voice_Flag as two independent inputs, and
   SHALL resolve each flag without reference to the value supplied for the other flag.
2. THE Config_Resolver SHALL accept a supplied value for each flag from either the process environment
   or the per-session dashboard configuration.
3. WHERE a value for the same flag is supplied both in the process environment and in the per-session
   dashboard configuration, THE Config_Resolver SHALL use the per-session dashboard configuration
   value for that flag, and SHALL apply this precedence to each flag separately so that a dashboard
   value for one flag never overrides the environment value of the other flag.
4. WHEN the Config_Resolver reads a supplied flag value, THE Config_Resolver SHALL remove leading and
   trailing whitespace and SHALL match the remaining characters against the recognised values without
   regard to letter case, so that `live`, `LIVE`, `Live`, and ` live ` resolve to the same engine, and
   `native`, `NATIVE`, and ` Native ` resolve to the same voice.
5. THE Config_Resolver SHALL treat a flag value that is absent, null, the empty string, or empty after
   whitespace removal as no value supplied for that flag.
6. WHERE no Voice_Flag value is supplied, THE Config_Resolver SHALL resolve the voice to `native`.
7. WHERE no Engine_Flag value is supplied, THE Config_Resolver SHALL resolve the engine to `legacy`.
8. IF a supplied Engine_Flag value, after whitespace removal and case-insensitive matching, is not
   `live` or `legacy`, THEN THE Config_Resolver SHALL resolve the engine to `legacy` and SHALL record
   the requested value and the reason for the change.
9. IF a supplied Voice_Flag value, after whitespace removal and case-insensitive matching, is not
   `native` or `elevenlabs`, THEN THE Config_Resolver SHALL resolve the voice to `native` and SHALL
   record the requested value and the reason for the change.
10. THE Config_Resolver SHALL return exactly one Runtime_Config whose engine is `live` or `legacy` and
    whose voice is `native` or `elevenlabs` for every pair of inputs, including every combination in
    which either input is absent, null, the empty string, whitespace only, a recognised value in any
    letter case or with surrounding whitespace, or any unrecognised string of up to 4096 characters.
11. IF the resolved pair is engine `legacy` with voice `native`, THEN THE Config_Resolver SHALL return
    engine `legacy` with voice `elevenlabs` and SHALL record the requested pair and the reason for the
    change.
12. THE Config_Resolver SHALL return a Runtime_Config in which voice `native` occurs only together
    with engine `live`.
13. THE Config_Resolver SHALL return a Runtime_Config for every input without raising an error and
    without leaving the engine or the voice unresolved.
14. WHEN the Config_Resolver records a coercion or a defaulted flag, THE Session_Runner SHALL emit an
    Operator_Note naming the requested value and the effective value for each affected flag, and SHALL
    join the meeting.
15. THE Session_Runner SHALL resolve the Runtime_Config exactly once per session, before the first
    audio frame or first model call of that session, and SHALL read the resolved values, never the
    supplied values, for every later decision in that session.
16. WHEN an operator changes the voice for a running session, THE Session_Runner SHALL emit an
    Operator_Note stating that the change applies to the next session, and SHALL continue the current
    meeting on the Voice_Path it started with.
17. WHERE the resolved voice is `native`, THE Session_Runner SHALL start the meeting without requiring
    an ElevenLabs credential and without pre-rendering acknowledgement audio.
18. WHERE the resolved voice is `elevenlabs`, IF the ElevenLabs credential is absent, THEN THE
    Session_Runner SHALL emit an Operator_Note indicating the missing credential and SHALL continue
    the meeting in its existing text-only degraded mode.

### Requirement 7: Both voice paths drive the same avatar

**User Story:** As a person in a meeting, I want Shannon's face to lip-sync to whatever she says
regardless of which voice is configured, so that the choice of voice is never visible as a broken
avatar.

#### Acceptance Criteria

1. THE Voice_Path SHALL deliver audio to the Avatar_Rig as 24 kHz mono signed 16-bit little-endian
   PCM at 2 bytes per sample and 48,000 bytes per second of speech, for both values of the Voice_Flag,
   and SHALL apply no format conversion on either Voice_Path.
2. THE Voice_Path SHALL deliver only whole audio samples to the Avatar_Rig, such that the byte count
   of every delivery to the Avatar_Rig is an exact multiple of 2.
3. IF audio becomes available for delivery with an odd trailing byte, THEN THE Voice_Path SHALL
   withhold that single byte from the current delivery and SHALL prepend it to the next delivery of
   the same Turn.
4. IF a Turn closes while a withheld trailing byte is still outstanding, THEN THE Voice_Path SHALL
   discard that byte and SHALL not prepend it to any delivery of a later Turn.
5. THE Voice_Path SHALL deliver the audio of one Turn to the Avatar_Rig in its original order, with no
   byte duplicated, omitted, or reordered, except for audio discarded by a Barge_In.
6. THE Voice_Path SHALL invoke the Avatar_Rig's speak operation at most once per Turn, and SHALL append
   all later audio of that Turn to the already-open Utterance, so that later audio within a Turn never
   preempts earlier audio of the same Turn.
7. WHEN an Utterance for a Turn is closed, THE Session_Runner SHALL emit on the Operator_Event_Stream
   an event carrying the identifier of that Turn, the number of speak invocations made for that Turn,
   and the total number of audio bytes delivered to the Avatar_Rig for that Turn.
8. WHEN the Live_Session reports that its generation for a Turn is complete, THE Voice_Path SHALL
   deliver the audio still buffered for that Turn and SHALL close the Utterance within 500
   milliseconds of that report.
9. WHEN the Avatar_Rig's upstream session is replaced while an Utterance is playing, THE Voice_Path
   SHALL rely on the Avatar_Rig's existing durable utterance behaviour rather than performing its own
   resend, SHALL resume delivery only from the first byte of that Turn not yet delivered to the
   Avatar_Rig, and SHALL not redeliver any audio already delivered to the Avatar_Rig.
10. WHEN the Voice_Path resumes delivery after the Avatar_Rig's upstream session is replaced, THE
    Session_Runner SHALL emit exactly one Operator_Note for that Turn stating that delivery resumed
    and identifying the Turn.
11. IF an Utterance ends because of a Barge_In, THEN THE Voice_Path SHALL not invoke the Avatar_Rig's
    speak operation again for that Turn and SHALL not replay or retry any audio of that Turn.
12. THE Session_Runner SHALL report, on the Operator_Event_Stream, which Voice_Path is active for the
    session.

### Requirement 8: Native audio voice path

**User Story:** As a person in a meeting, I want Shannon's speech to arrive as one continuous stream
she planned as a whole, so that her delivery carries a single intonation arc instead of audible seams.

#### Acceptance Criteria

1. WHERE the resolved voice is `native`, THE Session_Runner SHALL configure the Live_Session to
   respond with audio and to also produce an Output_Transcription of that audio, and SHALL treat that
   Output_Transcription as the only source of Shannon's own words on this path.
2. WHEN the Live_Session emits an audio chunk, THE Native_Audio_Path SHALL relay it to the Avatar_Rig
   without any intermediate synthesis step and without re-encoding it, at the same 24 kHz mono signed
   16-bit little-endian PCM format in which it arrived.
3. THE Native_Audio_Path SHALL open its Utterance for a Turn at the first moment it holds at least
   120 milliseconds of that Turn's audio, SHALL open at most one Utterance per Turn, and SHALL add no
   further delay beyond reaching that 120 millisecond prime.
4. WHILE the Live_Session has paused mid-Turn for 8000 milliseconds or less without reporting that its
   generation is complete, THE Native_Audio_Path SHALL keep the Utterance open and SHALL keep its
   audio stream parked rather than ending it, so that the pause is heard as a pause and not as the end
   of the Turn.
5. THE Native_Audio_Path SHALL hold every relayed byte the Avatar_Rig has not yet consumed in its own
   buffer rather than handing it to the Avatar_Rig ahead of demand, so that a Barge_In can discard it,
   and SHALL yield from that buffer only as fast as the Avatar_Rig consumes it.
6. IF the audio held in the Native_Audio_Path's buffer exceeds 1500 milliseconds of playback duration
   during a Turn, THEN THE Native_Audio_Path SHALL emit exactly one Operator_Note for that Turn
   reporting the buffered duration and that the Avatar_Rig may be stalled, SHALL retain the oldest
   audio, and SHALL discard no audio, because a mid-stream discard is audible and the breach indicates
   an Avatar_Rig stall rather than a memory fault.
7. WHEN an audio chunk ends part-way through a sample, THE Native_Audio_Path SHALL deliver only the
   whole samples of that chunk and SHALL carry the remaining bytes forward to be joined with the next
   chunk of the same Turn.
8. WHERE the resolved voice is `native`, THE Session_Runner SHALL not pre-render or play
   acknowledgement audio produced by any voice other than the Live_Session's own voice, because a
   foreign-voice filler in front of a native voice is worse than the gap it covers.
9. WHERE the resolved voice is `native`, THE Session_Runner SHALL instruct the Live_Session to produce
   speakable prose, because its words become audio with no text cleanup step in between.
10. IF the Live_Session has emitted no further audio for a Turn for more than 8000 milliseconds and
    has not reported that its generation is complete, THEN THE Native_Audio_Path SHALL treat that Turn
    as stalled, SHALL emit exactly one Operator_Note for that Turn identifying the Turn, SHALL deliver
    any audio still held in its buffer, and SHALL then close the Utterance.
11. WHERE the active Voice_Path is the Native_Audio_Path, THE Native_Audio_Path SHALL contribute no
    more than 120 milliseconds to the time from the end of the human's speech to the start of audible
    speech, so that its prime fits inside the 1200 millisecond 50th-percentile budget stated in
    Requirement 3.
12. IF a Turn on the Native_Audio_Path delivers audio but no Output_Transcription text by the time the
    Live_Session reports its generation complete, THEN THE Session_Runner SHALL emit exactly one
    Operator_Note for that Turn indicating that Shannon's words for that Turn were not captured.

### Requirement 9: ElevenLabs voice path

**User Story:** As the product owner, I want the designed ElevenLabs voice to remain a fully supported
option, so that Shannon's voice identity can be chosen on evidence rather than forced by the
architecture.

#### Acceptance Criteria

1. WHERE the resolved voice is `elevenlabs`, THE Session_Runner SHALL configure the Live_Session to
   respond with text and SHALL not configure it to respond with audio.
2. WHERE the resolved voice is `elevenlabs`, WHEN the Live_Session emits text fragments, THE
   Clause_Assembler SHALL emit the first clause of the Turn as soon as an eligible boundary exists at
   or after 24 characters of held text, and SHALL emit every later clause of that Turn as soon as an
   eligible boundary exists at or after 40 characters of held text, so that speech begins before the
   Turn is complete while later clauses carry whole sentences.
3. THE Clause_Assembler SHALL emit clauses whose concatenation in emission order, together with any
   text still held, reproduces exactly the text it was given for that Turn, apart from whitespace
   trimmed at clause boundaries, with no character duplicated and none dropped.
4. THE Clause_Assembler SHALL end each clause at the first applicable candidate in this order: the
   last strong terminator in the held text (period, question mark, exclamation mark, ellipsis, or
   newline); otherwise, once the held text has reached the minimum length in criterion 2, the last
   weak boundary (comma, semicolon, colon, or em dash); otherwise, once the held text has reached 180
   characters, the last space at or before that position; and SHALL never place a clause end inside a
   word.
5. THE Clause_Assembler SHALL emit no clause that is empty or that contains only whitespace.
6. WHEN the Live_Session reports that its generation for a Turn is complete, THE Clause_Assembler
   SHALL emit all text it still holds as a final clause of that Turn, subject to criterion 5.
7. WHEN the Clause_Assembler is told to discard, THE Clause_Assembler SHALL emit no clause containing
   text it received before that point.
8. THE ElevenLabs_Path SHALL join the synthesized audio of every clause of a Turn, in emission order,
   into exactly one Utterance, and SHALL open no more than one Utterance per Turn, and because each
   clause is a separate synthesis request whose pitch contour restarts, an audible prosody seam at
   each clause boundary is accepted behaviour of this path, so THE ElevenLabs_Path SHALL not
   re-synthesize, overlap, or cross-fade clauses in an attempt to hide those seams.
9. IF synthesis fails for any clause of a Turn, THEN THE ElevenLabs_Path SHALL stop synthesizing the
   remaining clauses of that Turn, SHALL leave audio already delivered to the Avatar_Rig in place,
   SHALL deliver the full text of that Turn to Meet chat, and SHALL emit at most one Operator_Note
   reporting synthesis failure per session.
10. WHEN the Clause_Assembler emits a clause, THE Session_Runner SHALL emit that clause text on the
    Operator_Event_Stream in emission order.
11. THE Clause_Assembler SHALL treat a period, comma, colon, or ellipsis as an eligible boundary only
    when it is not interior to a Protected_Span, and IF the only candidate boundary falls interior to
    a Protected_Span, THEN THE Clause_Assembler SHALL continue holding text until an eligible boundary
    occurs outside that span, and at the 180-character ceiling SHALL cut at the last space that lies
    outside every Protected_Span.
12. WHEN the Live_Session has produced no further text fragment for 120 milliseconds while the
    Clause_Assembler holds non-empty text for which criterion 4 has found no eligible boundary, THE
    Clause_Assembler SHALL emit the held text as one clause, cutting only at a position permitted by
    criteria 4 and 11.
13. IF a clause to be synthesized is longer than the maximum input length the synthesizer accepts,
    THEN THE ElevenLabs_Path SHALL divide it into consecutive segments each within that limit,
    dividing at the last space at or before the limit that lies outside every Protected_Span, or, when
    the segment contains no such space, exactly at the limit, and SHALL synthesize those segments in
    order into the same Utterance without dropping, reordering, or duplicating any text.

### Requirement 10: Barge-in

**User Story:** As a person in a meeting, I want Shannon to stop talking the instant I start, and to
stay stopped, so that interrupting her feels like interrupting a person rather than fighting a
recording.

#### Acceptance Criteria

1. WHILE the Avatar_Rig is speaking, WHEN room transcription produces a transcript segment attributed
   to a participant identity other than Shannon's own that contains at least one non-whitespace
   character after trimming, THE Barge_In_Detector SHALL classify the segment as a Barge_In and SHALL
   stop Shannon's speech such that no further audio of the interrupted Turn is delivered to the room
   more than 200 milliseconds after the segment is received.
2. THE Barge_In_Detector SHALL apply no minimum word count, no minimum character count beyond one
   non-whitespace character, and no minimum speech duration when classifying a Barge_In, so that a
   single filler syllable from a human qualifies.
3. WHILE the Avatar_Rig is speaking, IF the human speech begins within 400 milliseconds of Shannon's
   own speech ending, THEN THE Barge_In_Detector SHALL treat it as normal conversation rather than a
   Barge_In, and SHALL leave the current Turn's audio delivery unchanged.
4. WHEN a Barge_In occurs, THE Avatar_Rig SHALL mute locally within 50 milliseconds of classification,
   and SHALL perform this local mute before issuing any request that leaves the process and before any
   discard or notification step of this requirement.
5. WHEN a Barge_In occurs, THE Voice_Path SHALL, after the local mute has taken effect, discard every
   buffered audio frame and every queued or partially synthesized clause of the interrupted Turn that
   has not already been delivered to the room, leaving zero such items pending.
6. WHEN a Barge_In occurs, THE Session_Runner SHALL report to the Live_Session, exactly once for that
   Turn and within 300 milliseconds of classification, the extent of the Turn actually delivered to
   the room, measured as the duration of delivered audio in milliseconds and the text of the clauses
   fully delivered, so that the session's history contains that delivered prefix and no undelivered
   remainder.
7. WHEN a Barge_In has occurred for a Turn, THE Voice_Path SHALL deliver no further audio or clause
   from that Turn to the Avatar_Rig, including audio or clauses that arrive from the Live_Session or
   the synthesizer after classification.
8. WHEN a Barge_In has occurred for a Turn, THE Shannon_Agent SHALL not resume, retry, or repeat any
   discarded audio or clause of that Turn in that Turn or any later Turn.
9. THE Barge_In_Detector SHALL produce the same classification outcome, and THE Voice_Path SHALL
   produce the same discard and stop-delivery outcome, for both values of the Voice_Flag, covering the
   Native_Audio_Path relaying model audio and the ElevenLabs_Path synthesizing clauses.
10. WHEN a Barge_In is classified for a Turn that has already been barged in, THE Voice_Path SHALL
    leave the muted and discarded state of that Turn unchanged, SHALL send no additional interruption
    report to the Live_Session, SHALL deliver no audio, and SHALL raise no error.
11. WHEN the Live_Session itself reports that its output was interrupted, THE Voice_Path SHALL discard
    the unspoken remainder of that Turn and SHALL apply criteria 7, 8, and 10 to that Turn.
12. IF a tool call for the interrupted Turn is in flight when a Barge_In occurs, THEN THE
    Session_Runner SHALL allow the tool call to complete and record its result in the Live_Session
    history, and SHALL produce no audio or clause from that result for the interrupted Turn.
13. WHEN a Barge_In occurs, THE Session_Runner SHALL emit an Operator_Note recording the Barge_In, the
    Turn identifier, and the delivered extent reported in criterion 6.
14. WHEN a Turn ends after a Barge_In, THE Voice_Path SHALL complete its end-of-Turn handling without
    delivering audio and without raising an error.

### Requirement 11: Transcript, state, and persistence integrity

**User Story:** As an operator reviewing a meeting, I want Shannon's own words recorded in the
transcript and the stored meeting exactly as the room heard them, so that the history is complete and
the next turn has correct context.

#### Acceptance Criteria

1. WHEN a Turn's speech ends, THE Session_Runner SHALL record exactly one agent-attributed transcript
   line for that Turn, carrying the Turn identifier and the Turn's end time, for both values of the
   Voice_Flag.
2. WHERE the active Voice_Path is the Native_Audio_Path, THE Session_Runner SHALL take Shannon's
   recorded words from the Live_Session's Output_Transcription and SHALL use no other source for them.
3. WHERE the active Voice_Path is the ElevenLabs_Path, THE Session_Runner SHALL take Shannon's
   recorded words from the clauses whose synthesized audio was delivered to the Avatar_Rig, joined in
   delivery order.
4. WHEN a Turn ended after a Barge_In, THE Session_Runner SHALL record only the portion of the Turn
   that the room actually heard, as reported to the Live_Session under Requirement 10, and SHALL
   exclude every discarded or undelivered clause and every unspoken remainder from the recorded line,
   so that the transcript matches what the room heard.
5. IF a Turn produced audible speech but no Output_Transcription, THEN THE Session_Runner SHALL record
   a placeholder transcript line for that Turn that is agent-attributed, is explicitly marked as a
   placeholder distinguishable from verbatim speech, contains no text purporting to be Shannon's
   words, and identifies the Turn and its end time, and SHALL emit one Operator_Note for that Turn, so
   that the gap is visible rather than silent.
6. IF a placeholder transcript line was recorded for a Turn, THEN THE Session_Runner SHALL include
   that line in the next Turn's context marked as a placeholder and SHALL treat its text as no part of
   Shannon's spoken words.
7. IF Output_Transcription is missing for two or more Turns in a session, THEN THE Session_Runner
   SHALL emit at most one Operator_Note per session stating that the transcript for the session is
   degraded.
8. WHEN a transcript line is recorded, THE Session_Runner SHALL persist the meeting to MongoDB using
   the existing persistence behaviour, and SHALL record the line before beginning persistence.
9. WHEN a transcript line is recorded, THE Session_Runner SHALL emit it on the Operator_Event_Stream
   after the line is recorded and within 1 second of recording it, so that the dashboard transcript
   stays current.
10. WHEN two or more transcript lines are recorded in a session, THE Session_Runner SHALL persist them
    and SHALL emit them on the Operator_Event_Stream in the same order in which they were recorded.
11. IF persistence to MongoDB fails for a recorded transcript line, THEN THE Session_Runner SHALL
    retain the recorded line in the session transcript, SHALL still emit the line on the
    Operator_Event_Stream, SHALL emit an Operator_Note indicating that persistence failed for that
    Turn, and SHALL continue the session without ending it.
12. THE Session_Runner SHALL include every recorded agent-attributed transcript line of the session,
    in recorded order, in the context available to the next Turn.

### Requirement 12: Slot filling and standing memory

**User Story:** As a person in a meeting, I want Shannon to remember what the task needs, what she has
already been told, and what she has already done, so that she asks only for what is missing and never
repeats an action.

#### Acceptance Criteria

1. WHEN the Live_Session requests a state update, THE Session_Runner SHALL apply it to the
   Meeting_State before the Live_Session's next Turn begins, SHALL replace the active task only if the
   update supplies one, SHALL merge the update's collected values into the existing collected values,
   and SHALL retain unchanged every collected value and every completed action entry the update does
   not mention.
2. WHEN a state update supplies a non-empty value for a key that is already present in the
   Meeting_State's collected values, THE Session_Runner SHALL replace the stored value with the
   supplied value, SHALL keep exactly one entry for that key, and SHALL keep that key absent from the
   missing keys, so that a corrected answer overwrites the earlier answer rather than accumulating
   alongside it.
3. IF a state update supplies an empty value for a key that is present in the Meeting_State's
   collected values, THEN THE Session_Runner SHALL remove that key from the collected values, SHALL
   add that key to the missing keys, and SHALL emit the new state on the Operator_Event_Stream, so
   that a person who changes their mind clears the slot and Shannon asks for it again.
4. WHEN any state update has been applied, THE Session_Runner SHALL keep the Meeting_State's missing
   keys and collected keys disjoint, so that no key is ever both collected and missing, and SHALL
   discard from the update's missing keys any key that the resulting collected values contain.
5. IF a state update would delete, reorder, or modify an existing entry in the Meeting_State's
   completed actions, THEN THE Session_Runner SHALL leave the completed action entries unchanged,
   SHALL still apply the remaining parts of the same update, and SHALL emit an Operator_Note reporting
   that a conflicting completed-action change was rejected, so that a completed action can never be
   presented to Shannon as not yet done.
6. WHEN the Live_Session requests that a fact be remembered, THE Session_Runner SHALL add it to
   Standing_Memory, SHALL retain at most 24 entries by discarding the oldest entries first, and SHALL
   add no entry that matches an existing entry when compared without regard to letter case.
7. THE Session_Runner SHALL include the Meeting_State — active task, collected values, missing keys,
   and completed actions — and Standing_Memory in the Live_Session's instruction as the ground truth
   Shannon must not contradict, SHALL refresh that instruction before the next Turn begins whenever
   either changes, and SHALL include the same Meeting_State and Standing_Memory, unchanged by the
   replacement itself, in the instruction of any replacement Live_Session.
8. THE Session_Runner SHALL retain at most 12 completed action entries, keeping the 12 most recent
   ones in the order in which they occurred and discarding the oldest first.
9. WHEN the Meeting_State changes, THE Session_Runner SHALL emit the resulting state on the
   Operator_Event_Stream.
10. THE Session_Runner SHALL apply Slot_Filling and Standing_Memory identically for both values of the
    Voice_Flag.

### Requirement 13: Session lifecycle, rotation, and context replay

**User Story:** As a person in a meeting, I want Shannon to keep the thread of the conversation even
when her underlying connection is replaced, so that a technical event does not make her forget what we
were doing or repeat something she already did.

#### Acceptance Criteria

1. WHEN the Live_Session signals it is about to close, THE Session_Runner SHALL begin opening a
   replacement Live_Session while the current Live_Session is still open, and SHALL begin at most one
   replacement at a time for a given Live_Session.
2. IF the Live_Session closes or errors without signalling that it is about to close, THEN THE
   Session_Runner SHALL begin opening a replacement Live_Session within 500 milliseconds of observing
   the close, unless a replacement is already being opened.
3. WHEN the Session_Runner begins opening a replacement Live_Session, THE Session_Runner SHALL capture
   exactly one Conversation_Snapshot before its first attempt, SHALL include that same unmodified
   Conversation_Snapshot in the instruction of every subsequent attempt, SHALL make at most 5
   attempts, and SHALL wait at least as long before each attempt as it waited before the preceding
   attempt, starting at 500 milliseconds and never exceeding 8000 milliseconds.
4. THE Conversation_Snapshot SHALL carry the most recent Turn, at most 30 Turns, at most 6000
   characters of serialized snapshot text, whichever of the Turn and character bounds is reached
   first, together with the current Meeting_State, the Standing_Memory, and every completed action,
   and THE Session_Runner SHALL treat everything outside the Conversation_Snapshot — Turns dropped by
   either bound, output of the Turn interrupted by the replacement that was never transcribed, and
   identifiers scoped to the closed Live_Session — as not surviving the replacement.
5. WHEN a Conversation_Snapshot is replayed into a replacement Live_Session, THE Session_Runner SHALL
   include in the instruction every completed action recorded in the Meeting_State, each identified by
   tool name and arguments, and SHALL state in that instruction that no listed action may be performed
   again.
6. WHEN a replacement Live_Session reports that setup is complete, THE Session_Runner SHALL close the
   previous Live_Session, SHALL emit exactly one Operator_Note naming the attempt number, and SHALL
   emit the new session state on the Operator_Event_Stream within 200 milliseconds.
7. WHERE a replacement Live_Session is opened, THE Session_Runner SHALL open it with the same
   Voice_Path and the same voice identity as the Live_Session it replaces, and SHALL apply no
   Voice_Flag change for the remaining lifetime of the meeting, so that a replacement is never audible
   as a change of voice.
8. IF all 5 attempts to open a replacement Live_Session fail, THEN THE Session_Runner SHALL report the
   session state as dead on the Operator_Event_Stream, SHALL emit exactly one Operator_Note, SHALL
   make no further attempt for the remainder of the meeting, and SHALL continue the meeting in its
   text-only degraded mode rather than ending it.
9. IF a replacement Live_Session issues a Function_Call_Request whose tool name and arguments match a
   completed action listed in the replayed Conversation_Snapshot, THEN THE Session_Runner SHALL not
   run the tool, SHALL answer that request with a Function_Call_Response carrying the recorded result
   of the completed action, and SHALL emit an Operator_Note reporting the suppressed repeat.
10. WHILE the Session_Runner is opening a replacement Live_Session, THE Session_Runner SHALL let audio
    already handed to the Avatar_Rig play to completion, SHALL begin no new Utterance, SHALL discard
    captured room audio rather than queueing it without bound, and SHALL resend an Utterance
    interrupted by the replacement only where the Avatar_Rig reports that fewer than 200 milliseconds
    of it were played, so that the room never hears audio it already heard.
11. IF a Function_Call_Request is outstanding when its Live_Session ends, THEN THE Session_Runner
    SHALL let the tool run to completion, SHALL send no Function_Call_Response for that request's
    identifier, and SHALL deliver the tool's result text to the replacement Live_Session as
    conversational context within 1000 milliseconds of that session reporting setup complete, and IF
    no replacement Live_Session becomes ready, THEN THE Session_Runner SHALL deliver that result text
    on the text-only degraded channel instead.

### Requirement 14: Muted mode, chat fallback, and long results

**User Story:** As an operator, I want Shannon to remain useful when she must not speak or cannot
speak, so that a muted meeting or a dead avatar degrades to text rather than to silence.

#### Acceptance Criteria

1. WHILE the session is muted, WHEN a Turn completes, THE Shannon_Agent SHALL post that Turn's text to
   Meet chat as exactly one message that coalesces every clause, fragment, and transcription segment
   of that Turn in their original order, SHALL post it within 2 seconds of the Turn completing, and
   SHALL deliver no audio to the Avatar_Rig for that Turn.
2. WHILE the session is muted, THE Session_Runner SHALL keep the session muted across every subsequent
   Turn and across any Live_Session replacement until a spoken command to speak aloud is recognised,
   and SHALL treat no other event as an instruction to unmute.
3. IF a coalesced Turn message exceeds 4000 characters, THEN THE Shannon_Agent SHALL post it as the
   fewest consecutive Meet chat messages of at most 4000 characters each, split only at clause
   boundaries, and SHALL post them in the Turn's original order.
4. IF the Avatar_Rig is unavailable, THEN THE Shannon_Agent SHALL post each completed Turn's text to
   Meet chat as exactly one coalesced message, SHALL continue to transcribe the room, and SHALL
   continue to run tools.
5. IF an Utterance is dropped before the room hears it, THEN THE Session_Runner SHALL post the
   undelivered portion of that Turn's text to Meet chat as exactly one message within 2 seconds of
   detecting the drop.
6. WHEN a Turn's speech text exceeds 600 characters, or WHEN a Turn conveys a Function_Call_Response
   whose result exceeds 600 characters or contains more than 5 enumerated items, THE Shannon_Agent
   SHALL speak a leading portion of at most 600 characters ending at a clause boundary and SHALL post
   the remaining text to Meet chat as exactly one message.
7. WHEN a message from a human participant is received in Meet chat, THE Session_Runner SHALL deliver
   its first 2000 characters to the Live_Session as conversational input within 2 seconds of receipt,
   and SHALL exclude messages the Shannon_Agent itself posted.
8. IF the Meet chat input cannot be located or accepted after 3 attempts spanning at least 5 seconds,
   THEN THE Session_Runner SHALL emit exactly one Operator_Note per session indicating that chat
   delivery is unavailable, SHALL retain the undelivered messages in their original order up to a
   limit of 20 messages while discarding the oldest beyond that limit, SHALL continue to transcribe
   the room and run tools, and SHALL post the retained messages in their original order once chat
   input is accepted again.
9. WHILE the session is muted, IF a human begins speaking while a Turn is still being produced, THEN
   THE Barge_In_Detector SHALL treat it as a Barge_In even though no Utterance is playing, THE
   Session_Runner SHALL permanently discard the remainder of that Turn without posting it to Meet
   chat, and THE Session_Runner SHALL issue no local mute request to the Avatar_Rig.
10. WHEN a Turn's text is posted to Meet chat, THE Session_Runner SHALL record that text as a
    transcript line attributed to the Shannon_Agent, with the same content and the same ordering
    relative to room transcript lines that it would have had if spoken aloud, and SHALL persist that
    line.
11. THE Session_Runner SHALL apply muted mode and chat fallback identically for both values of the
    Voice_Flag.
12. WHERE the active Voice_Path is the Native_Audio_Path, THE Session_Runner SHALL take the Meet chat
    text for a Turn from that Turn's complete Output_Transcription.

### Requirement 15: Operator observability

**User Story:** As an operator watching the dashboard, I want to see which path is live, what Shannon
is doing, and how fast she is doing it, so that I can compare the two voice paths on evidence and
diagnose problems while the meeting is running.

#### Acceptance Criteria

1. THE Session_Runner SHALL continue to emit transcript line, decision, avatar status, state, and note
   events on the Operator_Event_Stream with their existing meanings, and SHALL additionally emit live
   session state, Voice_Path, tool call, tool result, clause, and latency events, emitting exactly one
   latency event per completed Turn carrying the active Voice_Path and the whole number of
   milliseconds from the end of the triggering human speech to Shannon's first audible audio.
2. WHEN the first output of a Turn is produced, THE Session_Runner SHALL emit, within 500 milliseconds
   of that output, a decision record synthesized from that event describing the Turn as speech and
   reporting a confidence value of 1.
3. WHEN a tool is requested, THE Session_Runner SHALL emit a decision record identifying the tool and
   describing the outcome as in progress, and WHEN that tool's result is returned, THE Session_Runner
   SHALL emit a decision record for the same tool request updated with the outcome and the elapsed
   milliseconds of the call.
4. WHILE the session is muted, WHEN a Turn is posted to Meet chat, THE Session_Runner SHALL emit a
   decision record describing the Turn as a chat message and carrying the posted text.
5. THE Session_Runner SHALL derive no model confidence value from the Live_Session, SHALL report the
   confidence field of every synthesized decision record as the constant 1, and SHALL express the
   operator's confidence setting only as guidance text in the Live_Session's instruction.
6. WHERE the active Voice_Path is the Native_Audio_Path, THE Session_Runner SHALL emit zero clause
   events for the lifetime of the session, and THE Operator_Event_Stream consumer SHALL continue to
   present the Turn as progressing rather than stalled when clause events are absent.
7. WHILE a Turn is producing audio, THE Session_Runner SHALL emit the milliseconds of audio currently
   buffered by the active Voice_Path, as a value between 0 and 1500, at least once every 1000
   milliseconds, so that a stalled Turn is distinguishable from a silent one.
8. WHEN a dashboard client connects to the Operator_Event_Stream, THE Session_Runner SHALL deliver to
   that client, before any event generated after the connection, a catch-up sequence carrying the
   effective Voice_Path, the current Live_Session state, the current avatar status, the current
   Meeting_State including collected and missing items, and the retained transcript lines of the
   meeting up to the retention cap of 30 turns, and SHALL complete that catch-up within 2000
   milliseconds of the connection being accepted.
9. THE Session_Runner SHALL deliver events to each connected client in the order the events occurred,
   SHALL deliver each event to a given client at most once, and SHALL not emit a decision record for a
   Turn before the transcript line of the human input that triggered that Turn.
10. THE Session_Runner SHALL emit no credential value, including any configured API key, access token,
    or other secret, in any field of any Operator_Event_Stream event, and SHALL substitute a fixed
    redaction marker for any field value that matches a configured credential before emitting it.

### Requirement 16: Rollout safety and the legacy pipeline

**User Story:** As an operator, I want the previous pipeline to remain usable and the text-chat harness
to keep working, so that a failure in a live meeting is recoverable by configuration and the new
conversation path can be exercised without a browser.

#### Acceptance Criteria

1. WHERE the Engine_Flag is `legacy`, THE Session_Runner SHALL run the existing two-stage pipeline and
   SHALL produce the observable behaviour it produced before the Live pipeline was introduced, namely
   the same transcript lines, the same decision and narration records on the Operator_Event_Stream,
   the same Tool_Access decisions, the same Meet chat behaviour, and the same persisted meeting
   records.
2. THE Session_Runner SHALL resolve the Runtime_Config and select the engine exactly once, before the
   first audio frame of the session is forwarded, and SHALL hold the selected engine fixed for the
   remaining duration of that session.
3. THE Session_Runner SHALL use one shared audio capture, one shared Avatar_Rig, one shared
   Operator_Event_Stream, and one shared persistence path for both values of the Engine_Flag, such
   that a meeting run under either engine is readable by the dashboard with no engine-specific reader.
4. THE Session_Runner SHALL retain the existing decision and narration behaviour, in working order,
   for every release in which either the `legacy` engine or the text-chat harness still depends on it,
   and SHALL remove it only in a change that follows the change flipping the default Engine_Flag to
   `live`.
5. WHERE the text-chat harness is in use, THE Shannon_Agent SHALL hold a multi-turn conversation, and
   SHALL declare, request, authorize, announce, execute, and report tools, with no browser process and
   no Avatar_Rig, discarding synthesized audio rather than requiring a rig to accept it.
6. WHERE the text-chat harness is in use, THE Shannon_Agent SHALL exercise the same conversation
   component, the same tool declarations, the same Tool_Access enforcement, and the same long-result
   text-overflow behaviour that a meeting session uses, with no harness-only copy of that behaviour.
7. IF a change to the conversation behaviour, the tool declarations, or the Tool_Access rules cannot
   be exercised through the text-chat harness, THEN THE Session_Runner SHALL be treated as failing
   this requirement until either the harness exercises that change or the behaviour is documented as
   meeting-only.
8. THE Session_Runner SHALL allow the Engine_Flag and the Voice_Flag to be changed by environment
   configuration alone, with no code change and no rebuild, and SHALL apply the changed values at the
   start of the next session.
9. WHERE the Engine_Flag default is to be changed from `legacy` to `live`, THE Session_Runner SHALL
   have run the Live pipeline on the ElevenLabs_Path in at least 5 real meetings with no unrecovered
   failure, SHALL pass the Voice_Path conformance suite for both the ElevenLabs_Path and the
   Native_Audio_Path, SHALL meet the latency targets of Requirement 3 on the path being made default,
   and SHALL pass the text-chat harness, before that default is changed.
10. WHERE the Voice_Flag is `native`, THE Session_Runner SHALL offer the Native_Audio_Path as a
    selectable value only after it satisfies the same Voice_Path conformance suite the
    ElevenLabs_Path already satisfies, and SHALL keep it non-default until the A/B comparison of the
    two voice paths in real meetings has been recorded.
11. IF the Engine_Flag is returned to `legacy` after sessions have run under `live`, THEN THE
    Session_Runner SHALL restore the behaviour of criterion 1 at the start of the next session, with
    no data migration step, no schema change, and no loss of or edit to meetings already stored under
    either engine.

### Requirement 17: Excluded approaches

**User Story:** As a future maintainer, I want the rejected approaches recorded as requirements, so
that they are not reintroduced as though they had never been considered.

#### Acceptance Criteria

1. WHERE the Engine_Flag is `live`, THE Session_Runner SHALL place on the path between captured room
   audio and the Live_Session only in-process capture, resampling, and framing steps, SHALL add no
   network round trip to any service other than the Live_Session on that path, and SHALL make the
   decision to forward a frame without consulting any search, ranking, or relevance service.
2. WHEN a human turn ends, THE Session_Runner SHALL begin the Turn with no retrieval, search, or
   ranking query issued since that turn began, so that no such query is a precondition for responding.
3. WHERE a retrieval capability exists, THE Live_Session SHALL reach it only by issuing a
   Function_Call_Request, and THE Tool_Executor SHALL apply to it the same announcement rules and
   Tool_Access authorization decisions it applies to every other tool.
4. THE Session_Runner SHALL hold exactly one Voice_Path active from session start to session end, and
   SHALL report that same Voice_Path on the Operator_Event_Stream for every Turn of the session.
5. IF a voice change is requested while a session is running, THEN THE Session_Runner SHALL complete
   the session on the unchanged Voice_Path, SHALL apply the requested voice at the start of the next
   session, and SHALL emit an Operator_Note indicating the change was deferred to the next session.
6. THE Wake_Word_Gate SHALL perform its check in process with no network request and no disk read,
   SHALL not withhold, delay, reorder, or discard audio forwarded to the Live_Session, and SHALL have
   its result affect only the instruction text and the Operator_Event_Stream.
7. IF a component other than the Live_Session initiates a retrieval, search, or ranking query while a
   Turn is in progress, THEN THE Session_Runner SHALL complete the Turn without waiting for that query
   and SHALL emit an Operator_Note identifying the off-path query.
8. THE Session_Runner SHALL route every tool call through the existing Tool_Executor, and SHALL expose
   no second execution or authorization path by which a tool can run with Tool_Access decisions other
   than those the Tool_Executor makes.

### Requirement 18: Meeting purpose as standing briefing

**User Story:** As an operator who states what a meeting is for when I send Shannon into it, I want her
to hold that statement as a standing briefing, so that she starts the meeting knowing the objective and
can steer the conversation back to it instead of rediscovering it from the first few turns.

#### Acceptance Criteria

1. WHERE a Meeting_Purpose is supplied for a session, THE Session_Runner SHALL include it in the
   Live_Session's instruction before the first audio frame of that session is forwarded, so that the
   objective is available to the Shannon_Agent before any participant speaks.
2. WHERE a Meeting_Purpose is supplied for a session, WHEN the Meeting_State is initialised at session
   start, THE Session_Runner SHALL set the Meeting_State's active task to the Meeting_Purpose text
   rather than to the no-active-task placeholder, and SHALL emit the resulting Meeting_State on the
   Operator_Event_Stream.
3. WHEN the Live_Session has supplied an active task in a state update for the session, THE
   Session_Runner SHALL retain that model-supplied active task and SHALL NOT replace it with the
   Meeting_Purpose for the remainder of the session, so that the Meeting_Purpose seeds the active task
   exactly once and never overwrites the work item the Shannon_Agent is currently on.
4. WHERE no Meeting_Purpose is supplied for a session, THE Session_Runner SHALL include no purpose
   text, no placeholder standing in for a purpose, and no objective of its own composition in the
   Live_Session's instruction, SHALL initialise the Meeting_State's active task to the same no-active-
   task placeholder it used before this requirement, and SHALL continue to accept an active task
   inferred by the Live_Session from the conversation.
5. WHEN an operator changes the Meeting_Purpose of a running session while no Turn is in progress, THE
   Session_Runner SHALL apply the changed Meeting_Purpose to the Live_Session's instruction before the
   next Turn begins, SHALL not interrupt or replace the Live_Session, and SHALL emit the change on the
   Operator_Event_Stream.
6. IF an operator changes the Meeting_Purpose of a running session while a Turn is in progress, THEN
   THE Session_Runner SHALL leave that Turn's output unchanged, SHALL retain only the most recent
   pending Meeting_Purpose, and SHALL apply it to the Live_Session's instruction after the Live_Session
   reports that Turn complete and before the next Turn begins.
7. WHEN an operator changes the Meeting_Purpose of a running session, THE Session_Runner SHALL leave
   the Meeting_State's active task unchanged wherever the Live_Session has already supplied one, so
   that relabelling a meeting retitles it without redirecting work already under way.
8. THE Session_Runner SHALL place the Meeting_Purpose in the Live_Session's instruction inside an
   explicit delimited region labelled as the operator's stated objective and as untrusted content that
   describes a goal, SHALL place no other instruction text inside that region, and SHALL state in the
   instruction that the content of that region is a description of the meeting and not a directive to
   the Shannon_Agent.
9. THE Session_Runner SHALL derive the persona, the response guardrails, the Tool_Access decisions, and
   the Barge_In behaviour of a session from sources other than the Meeting_Purpose, such that for every
   Meeting_Purpose text the session's persona, guardrails, Tool_Access allow and refuse decisions, and
   Barge_In outcomes are identical to those of the same session with no Meeting_Purpose supplied.
10. IF a supplied or relabelled Meeting_Purpose exceeds 1000 characters, THEN THE Session_Runner SHALL
    include in the instruction only the leading portion of at most 1000 characters ending at the last
    space at or before that limit, SHALL emit exactly one Operator_Note per occurrence naming the
    supplied length and the included length, and SHALL join or continue the meeting rather than
    refusing it.
11. WHERE a Meeting_Purpose is supplied for a session, WHEN a transcript line is unrelated to the
    Meeting_Purpose and to the Meeting_State's active task, THE Shannon_Agent SHALL reference the
    Meeting_Purpose in the words with which it returns the conversation to the task, so that the
    deflection names the stated objective rather than a generic redirection.
12. WHERE a replacement Live_Session is opened, THE Session_Runner SHALL include the Meeting_Purpose in
    effect at the moment of replacement in that replacement Live_Session's instruction, unchanged by
    the replacement itself.
13. THE Session_Runner SHALL deliver the Meeting_Purpose into the instruction identically for both
    values of the Voice_Flag, and SHALL accept and deliver a Meeting_Purpose through the text-chat
    harness using the same conversation component a meeting session uses, with no harness-only copy of
    that behaviour.
14. THE Session_Runner SHALL continue to persist the Meeting_Purpose with the stored meeting using the
    existing persistence behaviour, such that it continues to title the meeting record, continues to be
    included in the full-text search index, and remains editable after the meeting has ended.

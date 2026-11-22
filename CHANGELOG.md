# Changelog

## [0.80.0](https://github.com/teamrig/teamrig-pane/compare/teamrig-pane-v0.79.0...teamrig-pane-v0.80.0) (2026-11-22)


### Features

* **ui:** the dedicated UI reads its team's register through teamrig read (T4761) ([74dc75d](https://github.com/teamrig/teamrig-pane/commit/74dc75d978cfdc502351fc8d2d1cf75999199472))


### Bug Fixes

* **ui:** every writer of the UI's store redraws it (T4761) ([b38d17a](https://github.com/teamrig/teamrig-pane/commit/b38d17ab65ae3f71593bba8e07617a588057a8d5))

## [0.79.0](https://github.com/teamrig/teamrig-pane/compare/teamrig-pane-v0.78.0...teamrig-pane-v0.79.0) (2026-11-22)


### ⚠ BREAKING CHANGES

* **pane:** the tree no longer reads team folders, except the week files behind the week bar (numbers only), now read by team-weeks.ts. The card's Handover row is gone: the document serves no handover. A peer team's card has no Launch row, and a hired peer no Scope or Reason. The tab says reading until the first sessions document arrives.
* **pane:** the pane needs a teamrig that serves `read` (interface 1.0); it no longer draws tasks, inbox or sessions from the files alone.
* **places:** TEAMRIG_PANE_TASKS_DIR and TEAMRIG_PANE_INBOX_DIR and the settings keys tasksDir and inboxDir are gone. Set the project up as a teamrig team (.teamrig.json or TEAMRIG_TEAM); a settings file still holding one of the keys is a WARN naming it.

### Features

* **pane:** a reader for teamrig's plan document, known by name (T4759) ([8f15d24](https://github.com/teamrig/teamrig-pane/commit/8f15d24791409865455000b4bc0f8130b060856e))
* **pane:** a task row holds the tracker item its ref names and whether a tracker brought it in (T4742) ([8fe87c6](https://github.com/teamrig/teamrig-pane/commit/8fe87c6395db6da2cb4625ecbda1d381fcc46557))
* **pane:** a task's card links and words its origin from the tracker item teamrig served (T4742) ([fc4ce75](https://github.com/teamrig/teamrig-pane/commit/fc4ce7570dc90c03e031fea5457c3d0c762f107b))
* **pane:** a task's card says its description was cut, from teamrig's served mark (T4759) ([fc36504](https://github.com/teamrig/teamrig-pane/commit/fc3650493cd945f86a1e0229f9c1a949a5f30dcc))
* **pane:** each read asks for the plan document, and a teamrig that lacks it still draws the rest (T4759) ([af3020d](https://github.com/teamrig/teamrig-pane/commit/af3020da3c2127a7c6dbe2a5e2e8e43be7fd60ea))
* **pane:** the not-set-up view lists the teams teamrig serves, not the kit home's folders (T4759) ([45572d2](https://github.com/teamrig/teamrig-pane/commit/45572d2a3e382db57e87afec80583ff226ea191e))
* **pane:** the owner cards are drawn from teamrig's plan document (T4759) ([d9476b7](https://github.com/teamrig/teamrig-pane/commit/d9476b7b8aadcebb5aa1e433ffc39279c0dc8d6c))
* **pane:** the pane draws its tasks, inbox and sessions from teamrig read (T4742) ([3ed6f5d](https://github.com/teamrig/teamrig-pane/commit/3ed6f5d6557bc8aeab248ce6255340d5aea7036a))
* **pane:** the plan reader reads each session's cards on the owner (T4759) ([1764f4e](https://github.com/teamrig/teamrig-pane/commit/1764f4e7edd5b965f6a57867ef5381e43d653a22))
* **pane:** the snapshot carries teamrig's plan, and a moved rank or needed task reads it again (T4759) ([441c5c0](https://github.com/teamrig/teamrig-pane/commit/441c5c0a182906706e301dcc02058f932f6f4868))
* **pane:** the task list, meta line and card read teamrig's plan, not a tree the pane folds (T4759) ([289c8a9](https://github.com/teamrig/teamrig-pane/commit/289c8a9718b4ede0ee190e47688a27f9b9cf6c0a))
* **pane:** the Teams tree is drawn from teamrig's sessions document (T4742) ([7bb8412](https://github.com/teamrig/teamrig-pane/commit/7bb84128795a2feb42d31597fa12a7b26a7d50f9))
* **places:** the register is always the team's; the folder settings go (T4742) ([e7959c8](https://github.com/teamrig/teamrig-pane/commit/e7959c867a528d0c78a10e8f6254b4800ca9d1db))
* **read:** a document record's fields read by name (T4742) ([8de5b22](https://github.com/teamrig/teamrig-pane/commit/8de5b221e01dde88844491ea95355f29cba00f3d))
* **read:** a document record's list of numbers, whole or noted (T4742) ([105f75d](https://github.com/teamrig/teamrig-pane/commit/105f75d43e00f058fad9f7cab8cd0217bb447db6))
* **read:** a document record's optional moment read as milliseconds (T4742) ([a70ab8b](https://github.com/teamrig/teamrig-pane/commit/a70ab8b6fda7926d757aacbfbc7331f3dd0edd74))
* **read:** a document record's required moment read as milliseconds (T4742) ([fc6f450](https://github.com/teamrig/teamrig-pane/commit/fc6f45067fbabbdf910407821c50abaee07626a9))
* **read:** a read names who asks: the session drawn and the conversation (T4742) ([8ddb03b](https://github.com/teamrig/teamrig-pane/commit/8ddb03b5cf1479028bedcdb3def38b878825b8ee))
* **read:** a served text as the pane may draw it (T4742) ([0e74d9d](https://github.com/teamrig/teamrig-pane/commit/0e74d9d33b9c3895f5e4e32cc9fc5e5841da8cbd))
* **read:** a team's leads, names and session lookup from the sessions document (T4742) ([83d535d](https://github.com/teamrig/teamrig-pane/commit/83d535d364897c58e1d4164c90629f21decb059e))
* **read:** every text a document serves is cleaned of control and direction characters (T4742) ([0f92684](https://github.com/teamrig/teamrig-pane/commit/0f9268430745b0205364a2e31dfd266dad80ca35))
* **read:** one teamrig read run for a poll's documents (T4742) ([c4a0145](https://github.com/teamrig/teamrig-pane/commit/c4a01453e0d2da6ff28423f8b5546f710bd7b8fe))
* **read:** the envelope of a teamrig read document (T4742) ([53f81ea](https://github.com/teamrig/teamrig-pane/commit/53f81ea656dff95f51e1d8e02ca4f96d1dde0cb2))
* **read:** the Inbox view's lines from the inbox document (T4742) ([a4c63ea](https://github.com/teamrig/teamrig-pane/commit/a4c63eafb478d353a339b23814875091f4604e03))
* **read:** the pane's task rows from the tasks document (T4742) ([b886456](https://github.com/teamrig/teamrig-pane/commit/b886456c2c098eb70cd551371ebdcd97c43831e2))
* **read:** the snapshot from the read documents over the file fold (T4742) ([0d5358c](https://github.com/teamrig/teamrig-pane/commit/0d5358c15ee40aec394b2c017020299bb48ab898))
* **read:** the team's settings from the config document (T4742) ([e4328fc](https://github.com/teamrig/teamrig-pane/commit/e4328fc2bb1cebcdacc4bcfa78448cbc4e8c691e))
* **read:** the Teams view's teams and sessions from the sessions document (T4742) ([8886a7e](https://github.com/teamrig/teamrig-pane/commit/8886a7ee5e2192b1b66e216d449668b7b22e5a88))


### Bug Fixes

* **pane:** a plan's time move reads the moment or null teamrig serves, never a stored text (T4759) ([4f50a4f](https://github.com/teamrig/teamrig-pane/commit/4f50a4fd8c528dec49b66eb3786d700fd906e850))
* **pane:** a team whose config names no lead has no lead, never its first session (T4742) ([e7b24fc](https://github.com/teamrig/teamrig-pane/commit/e7b24fcdc0686eda4b5d7ec7ed2cbbe499c52224))
* **read:** a row from the tasks document carries no description-cut mark (T4742) ([7332f74](https://github.com/teamrig/teamrig-pane/commit/7332f74911e2dd6ce19582395c367c5c12ccf9c7))


### Performance Improvements

* **pane:** only a move of a file a served document is built from starts a teamrig read (T4742) ([13112b3](https://github.com/teamrig/teamrig-pane/commit/13112b3d6f0addefda0ea4a2fc581a01742f417f))

## [0.78.0](https://github.com/teamrig/teamrig-pane/compare/teamrig-pane-v0.77.0...teamrig-pane-v0.78.0) (2026-11-21)


### Features

* **ui:** a frame painted from the head and the body's window (T4761) ([7ba2b19](https://github.com/teamrig/teamrig-pane/commit/7ba2b198676eb943175d0b4ed60fcb00001ad71b))
* **ui:** a front with the owner's and the sessions' acts (T4761) ([5aa4ca3](https://github.com/teamrig/teamrig-pane/commit/5aa4ca331b8cfb1ab264e6f301c3e5014ec54b4b))
* **ui:** a row laid out in a line, its stops in cells (T4761) ([243f255](https://github.com/teamrig/teamrig-pane/commit/243f2559c5b77684a1511acbb0eea6fa561f2c77))
* **ui:** a run of styled words and what a terminal reads of it (T4761) ([61b62d2](https://github.com/teamrig/teamrig-pane/commit/61b62d24d48e01ec3c67b4a0396ebeea893b1ede))
* **ui:** a slot of the body's window as rows (T4761) ([ab07802](https://github.com/teamrig/teamrig-pane/commit/ab07802d04b8a3035cb93282230e56dc91bf1327))
* **ui:** a store that tells of its writes (T4761) ([bf257be](https://github.com/teamrig/teamrig-pane/commit/bf257beec156dfde7922619babcad4f61f2393c6))
* **ui:** a terminal's input read as keys, clicks and the wheel (T4761) ([65223db](https://github.com/teamrig/teamrig-pane/commit/65223dba683e53d47fd74eea32056ca2fa870f61))
* **ui:** asks for a drawing coalesced into one (T4761) ([07bb510](https://github.com/teamrig/teamrig-pane/commit/07bb51000fd64fdd590db0cf1d9add506cb842e2))
* **ui:** the entry node runs, on the process's own terminal (T4761) ([13db662](https://github.com/teamrig/teamrig-pane/commit/13db6621c90fb372e0d3db8f21fa005b6b3fb799))
* **ui:** the focus ring read from a painted frame (T4761) ([2dda7f1](https://github.com/teamrig/teamrig-pane/commit/2dda7f1b8e7dbfb8d36b6f98fbd4cf037911139d))
* **ui:** the head as rows, its presses stops under the dock's keys (T4761) ([3a6e5d3](https://github.com/teamrig/teamrig-pane/commit/3a6e5d370950e522e075f654a95aec68716eb83f))
* **ui:** the loop that draws the screen and answers keys (T4761) ([f034494](https://github.com/teamrig/teamrig-pane/commit/f034494972141357ae87bbecff40cd0e33e291df))
* **ui:** the Note field a ring key names (T4761) ([f4c943a](https://github.com/teamrig/teamrig-pane/commit/f4c943a28be4d0faec8280888e9fd830a2a475e9))
* **ui:** the program over a process's streams, with its exit codes (T4761) ([3596a50](https://github.com/teamrig/teamrig-pane/commit/3596a50e302739db8e3c2e9b66c9740bc2d01f2e))
* **ui:** the program tells its holder when it ends (T4761) ([2077e3c](https://github.com/teamrig/teamrig-pane/commit/2077e3c8c9e2a8d897a574c392db939e0921c3ec))
* **ui:** the programs the UI runs, stopped as it ends (T4761) ([231643f](https://github.com/teamrig/teamrig-pane/commit/231643fda8b0e772499c14920b784e3c6b16f017))
* **ui:** the terminal behind a port, taken and given back whole (T4761) ([5a2d0d4](https://github.com/teamrig/teamrig-pane/commit/5a2d0d4ac4679051ba60b8dde12b52f5679230a8))


### Bug Fixes

* **ui:** the program defers by a zero timer, which every runner has (T4761) ([8938747](https://github.com/teamrig/teamrig-pane/commit/893874790b19f52129a60d3a27ee8829349af1a3))

## [0.77.0](https://github.com/teamrig/teamrig-pane/compare/teamrig-pane-v0.76.0...teamrig-pane-v0.77.0) (2026-11-20)


### Features

* **card:** a task whose description the snapshot left out says its length and that teamrig show prints it (T4784) ([0f0d569](https://github.com/teamrig/teamrig-pane/commit/0f0d5692c07ba37cafc57011f15b9e4fcf56d393))

## [0.76.0](https://github.com/teamrig/teamrig-pane/compare/teamrig-pane-v0.75.1...teamrig-pane-v0.76.0) (2026-11-20)


### Features

* **ci:** a commit subject gate holds every commit to &lt;type&gt;(&lt;area&gt;): &lt;what&gt; (T4363) ([a0661f5](https://github.com/teamrig/teamrig-pane/commit/a0661f5cb3b8a292177480c7f2ea0d6881b766c2))


### Bug Fixes

* **work:** a task created before a layout 5 window still marks for its owner (T4081) ([211253b](https://github.com/teamrig/teamrig-pane/commit/211253bacde60d378933ac1e37cca5eec4726f6c))

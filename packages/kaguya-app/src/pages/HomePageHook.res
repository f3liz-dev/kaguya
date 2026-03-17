// SPDX-License-Identifier: MPL-2.0

type timelineItem = {
  type_: Misskey.Stream.timelineType,
  name: string,
  category: [#standard | #antenna | #list | #channel],
}

type state =
  | Loading
  | Loaded({customTimelines: array<timelineItem>, selectedTimeline: timelineItem})
  | Error(string)

type hookResult = {
  state: state,
  selectTimeline: timelineItem => unit,
}

let standardTimelines = [
  {type_: #home, name: "ホーム", category: #standard},
  {type_: #local, name: "ローカル", category: #standard},
  {type_: #global, name: "グローバル", category: #standard},
  {type_: #hybrid, name: "ソーシャル", category: #standard},
]

let defaultLoadedState = (): state =>
  Loaded({
    customTimelines: standardTimelines,
    selectedTimeline: standardTimelines->Array.getUnsafe(0),
  })

let useTimelineSelector = (): hookResult => {
  let (state, setState) = PreactHooks.useState(() => defaultLoadedState())

  PreactSignals.useSignalEffect(() => {
    let loadTimelines = async () => {
      let clientOpt = PreactSignals.value(AppState.client)

      switch clientOpt {
      | Some(client) => {
          let customItems = []
          let antennas = PreactSignals.value(TimelineStore.antennas)
          let lists = PreactSignals.value(TimelineStore.lists)
          let channels = PreactSignals.value(TimelineStore.channels)

          if Array.length(antennas) == 0 && Array.length(lists) == 0 && Array.length(channels) == 0 {
            let (antennasResult, listsResult, channelsResult) = await Promise.all3((
              client->Misskey.CustomTimelines.antennas,
              client->Misskey.CustomTimelines.lists,
              client->Misskey.CustomTimelines.channels,
            ))
            TimelineStore.setFromInitData(
              ~antennasResult,
              ~listsResult,
              ~channelsResult,
              ~homeTimelineResult=None,
            )
          }

          PreactSignals.value(TimelineStore.antennas)->Array.forEach(antenna => {
            switch Misskey.CustomTimelines.extractIdAndName(antenna) {
            | Some((id, name)) => customItems->Array.push({type_: #antenna(id), name, category: #antenna})
            | None => ()
            }
          })

          PreactSignals.value(TimelineStore.lists)->Array.forEach(list => {
            switch Misskey.CustomTimelines.extractIdAndName(list) {
            | Some((id, name)) => customItems->Array.push({type_: #list(id), name, category: #list})
            | None => ()
            }
          })

          PreactSignals.value(TimelineStore.channels)->Array.forEach(channel => {
            switch Misskey.CustomTimelines.extractIdAndName(channel) {
            | Some((id, name)) => customItems->Array.push({type_: #channel(id), name, category: #channel})
            | None => ()
            }
          })

          let allTimelines = Array.concat(standardTimelines, customItems)
          setState(_ => Loaded({
            customTimelines: allTimelines,
            selectedTimeline: standardTimelines->Array.getUnsafe(0),
          }))
        }
      | None => {
          let authState = PreactSignals.value(AppState.authState)
          if authState != LoggingIn {
            setState(_ => Error("Not connected"))
          }
        }
      }
    }

    let _ = loadTimelines()
    None
  })

  let selectTimeline = (timeline: timelineItem) => {
    setState(prev =>
      switch prev {
      | Loaded(data) => Loaded({...data, selectedTimeline: timeline})
      | _ => prev
      }
    )
  }

  {state, selectTimeline}
}

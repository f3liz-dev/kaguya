// SPDX-License-Identifier: MPL-2.0

@jsx.component
let make = () => {
  let {state, selectTimeline} = HomePageHook.useTimelineSelector()

  <Layout>
    {switch state {
    | HomePageHook.Loading =>
      <div className="loading-container">
        <p> {Preact.string("読み込み中...")} </p>
      </div>
    | HomePageHook.Error(msg) =>
      <div className="timeline-error">
        <p> {Preact.string("エラー: " ++ msg)} </p>
      </div>
    | HomePageHook.Loaded({customTimelines, selectedTimeline}) =>
      <div className="timeline-selector-container">
        <div className="timeline-tabs">
          {customTimelines
          ->Array.map(timeline => {
            let isActive = timeline.type_ == selectedTimeline.type_
            let categoryIcon = switch timeline.category {
            | #standard => ""
            | #antenna => "📡 "
            | #list => "📋 "
            | #channel => "📺 "
            }
            <button
              key={timeline.name}
              className={isActive ? "timeline-tab active" : "timeline-tab"}
              onClick={_ => selectTimeline(timeline)}
            >
              {Preact.string(categoryIcon ++ timeline.name)}
            </button>
          })
          ->Preact.array}
        </div>
        <Timeline timelineType={selectedTimeline.type_} name={selectedTimeline.name} />
      </div>
    }}
  </Layout>
}

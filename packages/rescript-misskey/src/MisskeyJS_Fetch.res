// MisskeyJS_Fetch.res - Fetch implementation for generated API code
// This module provides the fetch function required by the generated OpenAPI code

type fetchOptions = {
  url: string,
  method_: string,
  body: option<JSON.t>,
}

type fetchFn = fetchOptions => promise<JSON.t>

// Create a fetch function for a Misskey instance
let make = (~origin: string, ~credential: option<string>=?): fetchFn => {
  let baseUrl = origin->String.endsWith("/") ? origin : origin ++ "/"
  let apiBase = baseUrl ++ "api"

  (options: fetchOptions) => {
    let {url, method_, body} = options
    
    // Remove leading slash if present
    let endpoint = url->String.startsWith("/") 
      ? url->String.slice(~start=1, ~end=String.length(url)) 
      : url
    
    let fullUrl = apiBase ++ "/" ++ endpoint

    // Prepare headers as dict
    let headers = Dict.make()
    headers->Dict.set("Content-Type", "application/json"->JSON.Encode.string)

    // Add credential to body if provided
    let bodyWithCredential = switch (body, credential) {
    | (Some(bodyJson), Some(token)) => {
        // Merge credential into body
        let obj = bodyJson->JSON.Decode.object->Option.getOr(Dict.make())
        obj->Dict.set("i", token->JSON.Encode.string)
        obj->JSON.Encode.object->Some
      }
    | (Some(bodyJson), None) => Some(bodyJson)
    | (None, Some(token)) => {
        let obj = Dict.make()
        obj->Dict.set("i", token->JSON.Encode.string)
        obj->JSON.Encode.object->Some
      }
    | (None, None) => None
    }

    // Make the fetch request
    let bodyString = bodyWithCredential->Option.map(json => JSON.stringify(json))
    
    Fetch.fetch(
      fullUrl,
      Fetch.makeRequestInit(
        ~method=method_,
        ~headers=headers->JSON.Encode.object,
        ~body=?bodyString,
        ()
      )
    )
    ->Promise.then(response => {
      if response.ok {
        response->Fetch.json
      } else {
        // Handle error response
        response->Fetch.json
        ->Promise.then(_errorJson => {
          let _status = response.status
          let error: exn = %raw(`new Error("API Error (" + _status + "): " + JSON.stringify(_errorJson))`)
          Promise.reject(error)
        })
      }
    })
  }
}

// Convenience function to make a fetch function without credentials
let makePublic = (~origin: string): fetchFn => {
  make(~origin)
}

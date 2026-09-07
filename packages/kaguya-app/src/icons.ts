// The Tabler icons this app draws, and nothing else. scripts/gen-icons.mjs
// writes icons.data.json at build/dev start from every `tabler:<name>` found
// in src/ — so there is no list here to forget to update.
import { addCollection } from 'iconify-icon'
import data from './icons.data.json'

addCollection(data)

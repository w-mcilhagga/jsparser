/* RFC4180 style csv parser.

   The grammar is equivalent but not identical to the one in the RFC
   particularly in the choice of what to put in the lexer vs grammar.

   Returns either 
      {
        header: [...], 
        data:[[...],[...],...] 
      }
   or
      { 
        data:[[...]]
      }

   where all fields in header and data are strings
*/

import { Lexer } from '../jsparser.js'

let L = new Lexer(
    { quoted: /"(?:""|\\"|[^"])*"/ }, // extensions: escaped " in quoted field
    { quoted: /'(?:''|\\'|[^'])*'/ }, // extension: single quotes
    { crlf: /\r?\n/ }, // extension: just \n allowed in RFC4180
    { comma: ',' },
    { whitespace: false }
)
L.unknownhandler = function (token) {
    // this creates the non-quoted fields
    token.name = 'unquoted'
    return token
}

// make a parser with own state
import { create_parser } from '../jsparser.js'
let { node, match: $, eat: _, bt, init_state, get_state, many } = create_parser()

let rpt = (p) => many(bt(p))

// grammar - since we create a json object directly using node actions,
// the node names don't matter
let csvfile = () => file_and_header() || file()
let file_and_header = node(() => header() && file())
let file = node(() => record() && rpt(() => _('crlf') && record()) && (_('crlf') || true))
let header = node(() => record() && _('crlf'))
let record = node(() => field() && rpt(() => _('comma') && field()))
let field = node(() => $('quoted') || $('unquoted'))

// actions
file_and_header.action((n) => ({ ...n.children[0], ...n.children[1] }))
file.action((n) => ({ data: n.children }))
header.action((n) => ({ header: n.children[0] }))
record.action((n) => n.children)
field.action((n) => {
    // converts field node to string
    n = n.children[0]
    return n.name == 'quoted' ? n.text.slice(1, -1) : n.text
})

// wrap everything in a single function
export function csv(str) {
    init_state(L.tokenize(str))
    return csvfile() && get_state().ast[0]
}

/** A lexer or tokenizer converts input into an array of tokens.
 *  The parsers expect the tokens to be objects {name, text, cursor} where
 *      name is the name of the token
 *      text is the part of the input string that contains the token
 *      cursor is the location in the text that the token occurred at
 *
 *  For example, an input '1+2' might be converted into an array of three
 *  tokens
 *  @example
 *  [
 *    {name:'number', text:'1', cursor:0},
 *    {name:'addition', text:'+', cursor:1},
 *    {name:'number', text:'2', cursor:3}
 *  ]
 */

/** escapes a string to make a source string for a regular expression
 *  matching the string.
 *  @param s {string} - the string to turn into a regular expression source
 *  @returns {string}
 */
function escaped(s) {
    return s.replaceAll(/[()*+?-[\]\\^${}|]/g, (v) => '\\' + v)
}

/** the Lexer class */
export class Lexer {
    /** create a lexer object
     * @param {RegExp} ws - the whitespace regular expression
     * @property {bool} keepws - set this if you want to keep whitespace
     * as tokens
     */
    constructor(ws = /[ \r\n]+/) {
        this.tokens = {}
        if (ws) {
            this.tokens.whitespace = ws.source
        }
        this.keepws = false
    }

    /** deals with tokens that are not matched. An unmatched
     * token is a stretch of text between two matched tokens.
     * Replace this with your own handler if needed. The default is to
     * throw the unmatched token.
     *
     * If you don't want this, your unknowhandler must return a token
     * to add to the tokenlist.
     */
    unknownhandler(token) {
        throw token
    }

    /** define a token
     * @param {string} name - the name of the token
     * @param {string|RegExp} value - the token value. If a regular expression, it must not
     *    contain any capturing groups. If omitted, value is the same as name.
     * The order of definition matters; tokens that are prefixes of longer tokens should
     * be define dafter the longer token.
     */
    define(name, value) {
        if (value == undefined) {
            // the value is the name, for when you want to name a token e.g. '*'
            value = name
        }
        if (typeof value == 'string') {
            // string values are converted into regular expression source strings
            this.tokens[name] = escaped(value)
        }
        if (value.constructor == RegExp) {
            // if a regular expression, we just save the source string
            this.tokens[name] = value.source
        }
        // remove the tokenizer function to trigger compilation
        this.tokenizer = undefined
    }

    /** compile the tokens into one massive regular expression
     * This is called automatically by tokenize.
     * @returns an array of token objects
     */
    compile() {
        let src = [],
            tokennames = []
        // build a large regular expression by concatenating all the token
        // source strings into one. Each source string is in a capture group.
        for (let [k, v] of Object.entries(this.tokens)) {
            tokennames.push(k) // save the token name
            src.push('(' + v + ')')
        }
        // the regular expression is global because it's used in matchAll
        let re = new RegExp(src.join('|'), 'g')

        this.tokenizer = function (str) {
            let tokens = [],
                lastmatch = 0
            for (let m of str.matchAll(re)) {
                if (m.index > lastmatch) {
                    // there is a stretch of text that doesn't match any token
                    // so create an unknown token for this and
                    // pass it on to the unknownhandler
                    tokens.push(
                        this.unknownhandler({
                            name: 'unknown',
                            text: str.slice(lastmatch, m.index),
                            cursor: lastmatch,
                        })
                    )
                }
                // process the matched token
                let tokenno = m.slice(1).findIndex((x) => !!x), // find the matched group
                    name = tokennames[tokenno] // get the name from the position in match
                if (name != 'whitespace' || this.keepws) {
                    // add the token to the list if not whitespace,
                    // or if we're keeping whitespace
                    tokens.push({
                        name,
                        text: m[0],
                        cursor: m.index,
                    })
                }
                lastmatch = m.index + m[0].length
            }
            // if there is any trailing text after matchall, it's also unknown
            if (lastmatch < str.length) {
                tokens.push(
                    this.unknownhandler({
                        name: 'unknown',
                        text: str.slice(lastmatch),
                        cursor: lastmatch,
                    })
                )
            }
            return tokens
        }
    }

    /** turn a string into an array of tokens and returns a parse state
     * ready for input to the parser
     * @param {string} str - the string to tokenize.
     * @returns an initial parse state object consisting of {tokens, cursor, ast}
     *  where tokens is an array of tokens, cursor is the current token, and ast
     *  will be the syntax tree built up by the parser.
     */
    tokenize(str) {
        if (!this.tokenizer) {
            this.compile()
        }
        return { tokens: this.tokenizer(str), cursor: 0, ast: [] }
    }
}

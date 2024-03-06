/** parsers are functions that take a state object (as returned by a tokenizer) and
 *  If they succeed: update the state object & return it
 *  If they fail: leave the state unchanged and return false
 */

// jsdoc command - but the result is really terrible
// jsdoc jsparser.js -r README.md -d docs

export function create_parser(state) {
    /** set the global state object. Use this before you run the parser
     * @param {object} newstate - the new state object
     */
    function set_state(newstate) {
        state = newstate
    }

    /** initialize the global state object. Use this before you run the parser
     * @param {array} tokens - the array of tokens to parse
     * @param {number} next - the next token to parse (optional)
     * @param {array} ast - the abstract syntax tree (optional)
     */
    function init_state(tokens) {
        set_state({ tokens, next: 0, ast: [] })
    }

    /** return the global state object containing the results of the parse
     * @returns {Object} the state object
     */
    function get_state() {
        return state
    }

    /** push a copy of the current token on the ast stack and advance.
     * @returns {bool}
     */
    function keep() {
        if (state.tokens[state.next]) {
            state.ast.push({ ...state.tokens[state.next++] })
            return true
        } else {
            return false
        }
    }

    /** ignore the current token on the ast stack and advance.
     * @returns {bool}
     */
    function skip() {
        if (state.tokens[state.next]) {
            state.next++
            return true
        } else {
            return false
        }
    }

    /** check if the current token is a particular name.
     * @param {string} name - the name of the desired token
     * @returns {bool}
     */
    function is(name) {
        return state.tokens[state.next]?.name == name
    }

    /** pushes the current token onto the ast if it is a particular name.
     * @param {string} name - the name of the desired token
     * @returns {bool}
     */
    function match(name) {
        return is(name) && keep()
    }

    /** pushes the current token onto the ast if it isn't a particular name.
     * @param {string} name - the name of the token to avoid
     * @returns {bool}
     */
    function not(name) {
        return !is(name) && keep()
    }

    /** skips over the current token if it is a particular name.
     * @param {string} name - the name of the desired token
     * @returns {bool}
     */
    function eat(name) {
        return is(name) && skip()
    }

    /** stops backtracking  */
    function cut(label) {
        state.cut = { label, at: state.next }
        return true
    }

    /** matches the end of input
     * @returns {bool}
     */
    function END() {
        // true if we've reached the end of the input
        return state.next >= state.tokens.length
    }

    /** add backtracking to a parser function
     * @param {function} parser - the parser function
     * @returns {function} the parser function with backtracking.
     */
    function bt(parser) {
        function backtracker() {
            let saved_state = save(state)
            return parser() || restore(saved_state)
        }
        return backtracker
    }

    /** a parser that creates an ast node from the parse results
     * @param {string} name - the node name
     * @param {function} parser - the parser function
     * @param {number} count - the increase in ast length needed to make a node.
     * @returns {function} a backtracking parser function that creates a node.
     * A node parser can also execute actions following a successful parse.
     */
    function node(name, parser, count = 0) {
        function nodefn() {
            let saved_state = save(),
                result = parser()
            if (result && state.ast.length - saved_state.astlen > count) {
                let node = { name, children: state.ast.slice(saved_state.astlen) }
                state.ast.length = saved_state.astlen
                // call actions here, if return falsy then this is a parse failure
                for (let action of nodefn.actions) {
                    if (!(node = action(node))) {
                        return restore(saved_state)
                    }
                }
                state.ast.push(node)
            }
            return result || restore(saved_state)
        }
        nodefn.actions = []
        nodefn.action = (f) => action(nodefn, f)
        return nodefn
    }

    let cnode = (name, parser) => node(name, parser, 1)

    /** add an action to a node parser. This can also be done by calling parser.action(a)
     * @param {function} nodefn - a parser function returned by node(parser)
     * @param {function} act - the action function which takes the node and either
     *   changes it and returns it or returns false to signal failure
     */
    function action(nodefn, act) {
        nodefn.actions.push(act)
        return nodefn
    }

    /** save enough of the current parse state so it can be restored */
    function save() {
        return {
            next: state.next,
            astlen: state.ast.length,
        }
    }

    /** restore the state to its saved configuration. Triggers
     * an exception if we rewind past a cut
     */
    function restore(saved_state) {
        if (state?.cut?.at >= saved_state.next) {
            throw state
        }
        state.next = saved_state.next
        state.ast.length = saved_state.astlen
        return false
    }

    /** create a parser which runs another parser 0 or more times.
     * @param {function} parser - the parser function to run, which must be backtracking
     * @returns {bool} always true
     */
    function many(parser) {
        let next = state.next
        while (parser()) {
            if (state.next == next) {
                throw `parser in many() succeeded without consuming any tokens at token number ${cursor}`
            }
            next = state.next
        }
        return true
    }

    /** runs a traceing function
     * @param {function} printer - the traceing function, passed the
     *     global state and additional args
     * @oaram ...args - additional args to pass to the printer
     * @returns {bool} always true
     */
    function trace(printer, ...args) {
        printer(state, ...args)
        return true
    }

    return {
        init_state,
        set_state,
        get_state,
        keep,
        skip,
        is,
        match,
        not,
        eat,
        cut,
        END,
        bt,
        node,
        cnode,
        action,
        save,
        restore,
        many,
        trace,
    }
}

// our default parser
export let {
    init_state,
    set_state,
    get_state,
    keep,
    skip,
    is,
    match,
    not,
    eat,
    cut,
    END,
    bt,
    node,
    cnode,
    action,
    many,
    trace,
} = create_parser()

// escapes a string to make a source string for a regular expression
// matching the string
function escaped(s) {
    return s.replaceAll(/[()*+?-[\]\\^${}|/]/g, (v) => '\\' + v)
}

/** A lexer or tokenizer converts input into an array of tokens.
 * The parsers expect the tokens to be objects {name, text, cursor} where
 * * name is the name of the token
 * * text is the part of the input string that contains the token
 * * cursor is the location in the text that the token occurred at
 *
 * @param {array} ...definitions - the list of definitions
 * @property {bool} keepws - set this if you want to keep whitespace
 * as tokens
 *
 *  Any groups in a regex must be non capturing (?:...)
 *
 * @example For example, an input '1+2' might be converted into an array of three tokens
 * [
 *   {name:'number', text:'1', cursor:0},
 *   {name:'addition', text:'+', cursor:1},
 *   {name:'number', text:'2', cursor:3}
 * ]
 */
export class Lexer {
    constructor(...definitions) {
        this.definitions = definitions.map((d) => this.makedef(d))
        // add whitespace if not defined
        if (this.findtoken('whitespace') == -1) {
            this.define({ whitespace: /[ \r\n]+/.source })
        }
        this.keepws = false
    }

    makedef(d) {
        if (typeof d == 'string') {
            d = [d, escaped(d)]
        } else {
            d = [Object.keys(d)[0], Object.values(d)[0]]
            if (d[1].constructor == RegExp) {
                d[1] = d[1].source
            }
        }
        return d
    }

    findtoken(name) {
        return this.definitions.findIndex((d) => d[0] == name)
    }

    /** deals with tokens that are not matched. An unmatched
     * token is a stretch of text between two matched tokens.
     * Replace this with your own handler if needed. The default is to
     * throw the unmatched token.
     *
     * If you don't want this, your unknownhandler must return a token
     * to add to the tokenlist.
     */
    unknownhandler(token) {
        throw token
    }

    /** define a token
     * @param {string|Object} d - the token definition
     * @param {string} before - if given, the existing token to be inserted before.
     */
    define(d, before) {
        d = this.makedef(d)
        if (d.name == 'whitespace') {
            // we redefine whitespace if it exists
            let b = this.findtoken('whitespace')
            if (b != -1) {
                this.definitions[b] = d
                return
            }
        }
        // otherwise add/insert d
        if (!before) {
            this.definitions.push(d)
        } else {
            let b = this.findtoken(before)
            if (b == -1) {
                throw 'cant find the token'
            }
            this.definitions.splice(b, 0, d)
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
        for (let [k, v] of this.definitions) {
            if (v) {
                tokennames.push(k) // save the token name
                src.push('(' + v + ')')
            }
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
                    // if nothing has been consumed, this is an error.
                    if (m[0].length == 0) {
                        throw `token ${name} succeeded without consuming any input at character ${m.index}`
                    }
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
     * @returns an initial parse state object consisting of \{tokens, cursor, ast\}
     *  where tokens is an array of tokens, cursor is the current token, and ast
     *  will be the syntax tree built up by the parser.
     */
    tokenize(str) {
        if (!this.tokenizer) {
            this.compile()
        }
        return this.tokenizer(str)
    }
}

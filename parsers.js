/** parsers are functions that take a state object (as returned by a tokenizer) and
 *  If they succeed: update the state object & return it
 *  If they fail: leave the state unchanged and return false
 */

// BASIC PARSERS
// All other parsers are built up as combinations of these.

/** push the current token on the ast stack and advance.
 * @param {Object} state - the parse state
 * @returns {Object|bool} the changed state object or false if the cursor is past the end of the token array
 */
export function keep(state) {
    if (state.tokens[state.cursor]) {
        state.ast.push(state.tokens[state.cursor++])
        return state
    } else {
        return false
    }
}

/** ignore the current token on the ast stack and advance.
 * @param {Object} state - the parse state
 * @returns {Object|bool} the changed state object or false if the cursor is past the end of the token array
 */
export function skip(state) {
    if (state.tokens[state.cursor]) {
        state.cursor++
        return state
    } else {
        return false
    }
}

/** check if the current token is a particular name.
 * @param {string} name - the name of the desired token
 * @param {Object} state - the parse state
 * @returns {Object|bool} the unchanged state object if the token matches or false
 */
export function is(name, state) {
    return state.tokens[state.cursor]?.name == name && state
}

/** pushes the current token onto the ast if it is a particular name.
 * @param {string} name - the name of the desired token
 * @param {Object} state - the parse state
 * @returns {Object|bool} the changed state object if the token matches or false
 */
export function match(name, state) {
    return is(name, state) && keep(state)
}

/** pushes the current token onto the ast if it isn't a particular name.
 * @param {string} name - the name of the token to avoid
 * @param {Object} state - the parse state
 * @returns {Object|bool} the changed state object if the token matches or false
 */
export function not(name, state) {
    return !is(name, state) && keep(state)
}

/** skips over the current token if it is a particular name.
 * @param {string} name - the name of the desired token
 * @param {Object} state - the parse state
 * @returns {Object|bool} the changed state object if the token matches or false
 */
export function eat(name, state) {
    return is(name, state) && skip(state)
}

/** stops backtracking  */
export function cut(label, state) {
    state.cut = { label, cursor: state.cursor }
    return state
}

/** matches the end of input
 * @param {Object} state - the parse state
 * @returns {Object|bool} the (un)changed state object if at the end, or false
 */
export function END(state) {
    // true if we've reached the end of the input
    return state.cursor >= state.tokens.length && state
}

// abbreviations
export let $ = match,
    _ = eat

// PARSER COMBINATORS
/*
Parser functions can be built up from combinations of other parsers, almost as if they were in BNF

If the BNF is alternatives, e.g. A = B | C | D, this translates into a parser function

    let A = state => B(state) || C(state) || D(state)

If the BNF is a sequence, e.g. A = B C D, this translates into a parser function

    let A = state => B(state) && C(state) && D(state)

In this case, we must backtrack if C or D fail. To do this, we use the bt() function
to add backtracking.

    let A = bt( state => B(state) && C(state) && D(state) )

If the BNF is optional, e.g. A = B?, then we can do

    let A = state => B(state) || state

If the BNF is multiples, e.g. A = B*, then we use the many() function:

    let A = state => many(B, state)

In this case, parser function B must backtrack.


All of these will simply consume tokens and put them on the ast. To create a tree, we have
to declare the rule as a *node* e.g.

    let A = node('A', state => B(state) && C(state) && D(state))

This will grab all of the tokens matched by A and put them as children of a node labelled A.
(It also applies backtracking to the parser, so the call to bt() is unnecessary)

A cnode is a node which is conditional on more than one token being matched.

*/

/** add backtracking to a parser function
 * @param {function} parser - the parser function
 * @returns {function} the parser function with backtracking.
 */
export function bt(parser) {
    function backtracker(state) {
        let saved_state = save(state)
        return parser(state) ? state : restore(saved_state)
    }
    return backtracker
}

/** a parser that creates an ast node from the parse results
 * @param {string} name - the node name
 * @param {function} parser - the parser function
 * @param {number} count - the increase in ast length needed to make a node.
 * @returns {function} a parser function that creates a node.
 * A node parser can also execute actions following a successful parse.
 */
export function node(name, parser, count = 0) {
    // returns a backtracking parser which creates a named node
    function nodefn(state) {
        let saved_state = save(state)
        if (parser(state)) {
            if (state.ast.length - saved_state.astlen > count) {
                let children = state.ast.slice(saved_state.astlen)
                state.ast.length = saved_state.astlen
                let node = { name, children }
                // call actions here, if return falsy then this is a parse failure
                for (let action of nodefn.actions) {
                    if (!(node = action(node))) {
                        return restore(saved_state)
                    }
                }
                state.ast.push(node)
            }
            return state
        } else {
            return restore(saved_state)
        }
    }
    nodefn.actions = []
    nodefn.action = (f) => action(nodefn, f)
    return nodefn
}

export let cnode = (name, parser) => node(name, parser, 1)

/** add an action to a node parser. This can also be done by calling parser.action(a)
 * @param {function} nodeparser - the parser function returned by node(parser)
 * @param {function} act - the action function which takes the node and either
 *   changes it and returns it or returns false to signal failure
 */
export function action(nodeparser, act) {
    nodeparser.actions.push(act)
    return nodeparser
}

/** save enough of the current parse state so it can be restored */
export function save(state) {
    return {
        cursor: state.cursor,
        astlen: state.ast.length,
        state,
    }
}

/** restore the state to its saved configuration. Triggers cut if we rewind past a cut */
export function restore(saved_state) {
    let state = saved_state.state // the actual state object
    if (state?.cut?.cursor >= saved_state.cursor) {
        throw state
    }
    state.cursor = saved_state.cursor
    state.ast.length = saved_state.astlen
    return false
}

/** create a parser which runs another parser 0 or more times.
 * @param {function} parser - the parser function to run, which must be backtracking
 * @param {Object} state - the state object
 * @returns {Object} the state object following 0 or more successful runs of parser
 * (obviously, this will always succeed & is backtracking if parser is)
 */
export function many(parser, s) {
    while (parser(s)) {}
    return s
}

# jsparser

Write recursive descent parsers in almost-plain javascript. The rules of a grammar like EBNF translate nearly directly into javascript functions.

## Example - a calculator.

A calculator is the **hello-world** of parsers. A simple calculator grammar can be written in EBNF as follows (using something like the [W3C notation](https://www.w3.org/TR/REC-xml/#sec-notation), which is quite regular expression-like):

```
expr := addend ( add_op addend )*
addend := factor ( mult_op factor )*
factor := bracket | number
bracket := '(' expr ')'
number := [0-9]+
add_op := '+' | '-'
mult_op := '*' | '/'
```

This grammmar can be translated into a set of javascript functions:

```javascript
let expr = () => addend() && many(() => add_op() && addend())
let addend = () => factor() && many(() => mult_op() && factor())
let factor = () => bracket() || number()
let bracket = () => match('(') && expr() && match(')')
let number = () => match('number')
let add_op = () => match('+') || match('-')
let mult_op = () => match('*') || match('/')
```

This is just plain javascript, with a few functions `match` and `many`, and a (hidden, shared) parse state. Each of the parser functions will either change the parse state if they succeed and return `true`, or leave the parse state unchanged and return `false` if they fail.

The parse state is an object `{tokens, next, ast}` where

-   `tokens` is an array of token objects created by a tokenizer (see Tokenizers). Each token object has properties `name` and `text`: name is the name (type) of the token and text is the actual text value of the token. For example, a string like `1*2` might be tokenized to `[{name:'number', text:'1'}, {name:'*', 'text':'*'}, {name:'number', text:'3'}]`
-   `next` points to the next token to be processed. It starts at zero.
-   `ast` is the abstract syntax tree that will be built up by the parser. It starts as an empty array.

The parse state is in a closure shared with the parser functions `match` and `many`. It can be accessed directly with functions `init_state`, `set_state` and `get_state`.

The function `match(name)` checks that the current token in the shared state has the given name; that is, that `state.tokens[state.next].name == name` . If so, the token is copied to the ast and the next pointer is incremented. You could implement `match` as

```javascript
function match(name) {
    // shared state
    if (state.tokens[state.next].name == name) {
        state.next++
        return true
    } else {
        return false
    }
}
```

The function `many(p)` implements the `*` operator in EBNF: it takes a parser function `p` and applies the parser as many times as it can to the shared state. `many` could be implemented as follows:

```javascript
function many(parser) {
    while (parser()) {
        /* nothing */
    }
    return true
}
```

## Backtracking.

Parsers must leave the parse state unchanged when they fail. Some of these parsers don't do that. For example,

```javascript
let bracket = () => match('(') && expr() && match(')')
```

If the first parser function `match('(')` succeeds, it will change the shared parse state by advancing `state.next`. But then, if the second parser function `expr()` fails for some reason, then the `bracket` parser has failed but the state has been changed.

We have to to convert any parser function into one which is guaranteed to leave the parse state unchanged if it fails. We can do this by creating a backtracking function wrapper `bt`, which takes any parser and returns one that doesn't change the state if it fails:

```javascript
function bt(parser) {
    return () => {
        let saved = save()
        return parser() || restore(saved)
    }
}
```

This uses two functions that `save` the state configuration and `restore` it. The `restore` function always returns false, because by that point the parser has failed.

Here is a possible implementation of these functions:

```javascript
function save() {
    // shared state
    return { next: state.next, astlen: state.ast.length }
}

function restore(saved) {
    // shared state
    saved.state.next = saved.next
    saved.ast.length = saved.astlen
    return false
}
```

Not everything needs backtracking. We only have to apply backtracking to some sequences (typically, parsers that use `&&`). Putting backtracking in the above grammar gives us:

```javascript
let expr = () => addend() && many(bt(() => add_op() && addend()))
let addend = () => factor() && many(bt(() => mult_op() && factor()))
let factor = () => bracket() || number()
let bracket = bt(() => match('(') && expr() && match(')'))
let number = () => match('number')
let add_op = () => match('+') || match('-')
let mult_op = () => match('*') || match('/')
```

Notice that in the `expr` and `addend` parsers, the backtracking is only applied to the
parser function in the `many` clause. In the `expr` parser, if the first `addend()` parser succeeds, the following `many(...)` parser will also succeed so no backtracking is needed. However, the parser function passed into `many` must backtrack, so it is wrapped by `bt`.

Likewise, no backtracking is needed for parsers that are an alternative (e.g. `factor`), provided each branch in the alternative backtracks.

## Constructing the Syntax Tree.

If we take the parser `expr` and run it with a shared state object

```javascript
{
    tokens: [
        {name:'number', text:'1'},
        {name:'*', 'text':'*'},
        {name:'number', text:'3'}
    ],
    next:0,
    ast:[]
}
```

then the parse will succeed and the state will become

```javascript
{
    tokens: [
        {name:'number', text:'1'},
        {name:'*', 'text':'*'},
        {name:'number', text:'3'}
    ],
    next:3,
    ast:[
        {name:'number', text:'1'},
        {name:'*', 'text':'*'},
        {name:'number', text:'3'}
    ]
}
```

So the only thing that has happened is that the parser has recognized the list of tokens as a valid input to the grammar and transferred them to the `ast`. This isn't particularly useful - we'd like to construct a syntax tree showing the structure of the expression.

The way we do this is to note that some of the rules should create nodes in the syntax tree from the tokens or subrules that it has recognized. When a rule/parser succeeds, it extends the ast. We create the node by grabbing the part of the ast that the rule has added and putting it in a tree node. This can be done something like this:

```javascript
let astlen = state.ast.length,
    result = parser() // the parser rule being run
if (result && state.ast.length > astlen) {
    let node = { children: state.ast.slice(astlen) }
    state.ast.push(node)
}
```

This code is put in a wrapper function which turns a parser into one which creates a node when it succeeds:

```javascript
function node(nodename, parser) {
    return function () {
        let astlen = state.ast.length,
            result = parser() // the parser rule being run
        if (result && state.ast.length > astlen) {
            let node = { name: nodename, children: state.ast.slice(astlen) }
            state.ast.push(node)
        }
        return result
    }
}
```

With this defined, our new expression parser is

```javascript
let expr = node('expr', () => addend() && many(bt(() => add_op() && addend())))
let addend = node('addend', () => factor() && many(bt(() => mult_op() && factor())))
let factor = node('factor', () => bracket() || number())
let bracket = bt(() => match('(') && expr() && match(')'))
let number = () => match('number')
let add_op = () => match('+') || match('-')
let mult_op = () => match('*') || match('/')
```

Running this new parser on the previous input gives

```javascript
{
    tokens: [
        {name:'number', text:'1'},
        {name:'*', 'text':'*'},
        {name:'number', text:'3'}
    ],
    next:3,
    ast:[
        {name:'expr',
            children:[
                {name:'addend',
                children:[
                    {name:'factor',
                        children:[{name:'number', text:'1'}]
                    },
                    {name:'*', 'text':'*'},
                    {name:'factor',
                        children:[{name:'number', text:'3'}]
                    }
                ]}
            ]
        }
    ]
}
```

The node rules have structured the ast, and it now says that we have found an `expr` which consists of a single `addend` that consists of two `factor`s, each of which is a `number`.

## Catching Syntax Errors.

Because these parses backtrack, they may not consume all the input. For example, the string `1+` will be parsed as just `1` and the token corresponding to the `+` will be left unconsumed.

It's often quite difficult to figure out what the problem is, especially if a lot of backtracking has taken place. To solve this problem, there is a special parser `cut` which, once it has been passed, prevents backtracking. It could be used as follows:

```javascript
let expr = node('expr', () => addend() && many(bt(() => add_op() && cut(1) && addend())))
```

After the cut has been passed, if there is an addend everything is ok, but if the addend fails, the cut throws the parse state. By catching the state, you know what the problem is. Note that the cut alters the shared parse state to include a cut object `{at, label}` which says at which token the cut occurred, and the cut label (1 in this case).

Now, when parsing `1+`, the parser will throw the shared state object which has `state.cut = {label:1, at:1}`, from which a meaningful error message can be constructed. `state.tokens[state.cut.at]` is the last token successfully parsed (in this case, '+').

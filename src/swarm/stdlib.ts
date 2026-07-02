import type { DefSpec } from "./plan.ts";

/** The stdlib decomposition (#36) — the first genuinely wide workload: ~50
 *  definitions (each with a test task ⇒ ~100 tasks), critical path ~4-5,
 *  width ~25. Contracts are pinned as spec notes; helper prefixes make agent
 *  helper names collision-free by construction (#52). Deps name only entries
 *  in this array — prelude names (map, foldr, append, …) are already in the
 *  namespace and free to use. */
export const STDLIB: DefSpec[] = [
  // --- lists ------------------------------------------------------------
  { name: "reverse", intent: "reverse a list", deps: [], spec: "reverse : List a -> List a — reverse (Cons 1 (Cons 2 Nil)) == Cons 2 (Cons 1 Nil)", helperPrefix: "reverse" },
  { name: "take", intent: "first n elements", deps: [], spec: "take : Int -> List a -> List a — take 2 [1,2,3] == [1,2]; n <= 0 gives Nil; short lists are returned whole", helperPrefix: "take" },
  { name: "drop", intent: "all but the first n elements", deps: [], spec: "drop : Int -> List a -> List a — drop 2 [1,2,3] == [3]; n <= 0 returns the list; dropping past the end gives Nil", helperPrefix: "drop" },
  { name: "elem", intent: "membership for Int lists", deps: [], spec: "elem : Int -> List Int -> Bool", helperPrefix: "elem" },
  { name: "zip", intent: "pair up two lists, stopping at the shorter", deps: [], spec: "zip : List a -> List b -> List (Pair a b) — uses the prelude's Pair", helperPrefix: "zip" },
  { name: "foldl", intent: "left fold", deps: [], spec: "foldl : (b -> a -> b) -> b -> List a -> b — foldl f z [x1,x2] == f (f z x1) x2", helperPrefix: "foldl" },
  { name: "any", intent: "does any element satisfy the predicate", deps: [], spec: "any : (a -> Bool) -> List a -> Bool — any p Nil == false", helperPrefix: "any" },
  { name: "all", intent: "do all elements satisfy the predicate", deps: [], spec: "all : (a -> Bool) -> List a -> Bool — all p Nil == true", helperPrefix: "all" },
  { name: "replicate", intent: "n copies of a value", deps: [], spec: "replicate : Int -> a -> List a — replicate 0 x == Nil, negative n == Nil", helperPrefix: "replicate" },
  { name: "intersperse", intent: "a separator between elements", deps: [], spec: "intersperse : a -> List a -> List a — intersperse 0 [1,2] == [1,0,2]; singleton and Nil unchanged", helperPrefix: "intersperse" },
  { name: "last", intent: "final element with a default for Nil", deps: [], spec: "last : a -> List a -> a — last d Nil == d", helperPrefix: "last" },
  { name: "nth", intent: "index into a list with a default", deps: [], spec: "nth : a -> Int -> List a -> a — 0-based; out of range gives the default", helperPrefix: "nth" },
  { name: "countBy", intent: "how many elements satisfy the predicate", deps: [], spec: "countBy : (a -> Bool) -> List a -> Int", helperPrefix: "countBy" },
  { name: "maximum", intent: "largest Int with a floor default", deps: [], spec: "maximum : Int -> List Int -> Int — maximum d Nil == d", helperPrefix: "maximum" },
  { name: "minimum", intent: "smallest Int with a ceiling default", deps: [], spec: "minimum : Int -> List Int -> Int — minimum d Nil == d", helperPrefix: "minimum" },
  { name: "nub", intent: "remove duplicate Ints, keeping first occurrences", deps: ["elem"], spec: "nub : List Int -> List Int — nub [1,2,1] == [1,2]", helperPrefix: "nub" },
  { name: "sortInsert", intent: "insertion sort for Int lists", deps: [], spec: "sortInsert : List Int -> List Int — ascending", helperPrefix: "sortInsert" },
  { name: "sortByMerge", intent: "merge sort for Int lists", deps: ["take", "drop"], spec: "sortByMerge : List Int -> List Int — ascending, O(n log n); helpers sortByMergeSplit/sortByMergeMerge", helperPrefix: "sortByMerge" },
  { name: "isSorted", intent: "is an Int list ascending", deps: [], spec: "isSorted : List Int -> Bool — Nil and singletons are sorted", helperPrefix: "isSorted" },
  { name: "concat", intent: "flatten a list of lists", deps: [], spec: "concat : List (List a) -> List a — uses the prelude's append", helperPrefix: "concat" },

  // --- number theory ------------------------------------------------------
  { name: "absInt", intent: "absolute value", deps: [], spec: "absInt : Int -> Int", helperPrefix: "absInt" },
  { name: "signInt", intent: "sign as -1/0/1", deps: [], spec: "signInt : Int -> Int", helperPrefix: "signInt" },
  { name: "minInt", intent: "smaller of two", deps: [], spec: "minInt : Int -> Int -> Int", helperPrefix: "minInt" },
  { name: "maxInt", intent: "larger of two", deps: [], spec: "maxInt : Int -> Int -> Int", helperPrefix: "maxInt" },
  { name: "gcd", intent: "greatest common divisor", deps: ["absInt"], spec: "gcd : Int -> Int -> Int — Euclid; gcd 0 0 == 0, always non-negative", helperPrefix: "gcd" },
  { name: "lcm", intent: "least common multiple", deps: ["gcd", "absInt"], spec: "lcm : Int -> Int -> Int — lcm x 0 == 0", helperPrefix: "lcm" },
  { name: "pow", intent: "integer power", deps: [], spec: "pow : Int -> Int -> Int — pow b n for n >= 0; pow b 0 == 1; negative n gives 0", helperPrefix: "pow" },
  { name: "isEven", intent: "parity", deps: [], spec: "isEven : Int -> Bool — works for negatives", helperPrefix: "isEven" },
  { name: "isPrime", intent: "primality by trial division", deps: [], spec: "isPrime : Int -> Bool — n < 2 is false; helper isPrimeFrom", helperPrefix: "isPrime" },
  { name: "factorial", intent: "n!", deps: [], spec: "factorial : Int -> Int — factorial 0 == 1; negative gives 1", helperPrefix: "factorial" },
  { name: "fibonacci", intent: "nth Fibonacci number, linear time", deps: [], spec: "fibonacci : Int -> Int — 0,1,1,2,3…; helper fibonacciGo acc-style", helperPrefix: "fibonacci" },
  { name: "digits", intent: "decimal digits of a non-negative Int, most significant first", deps: [], spec: "digits : Int -> List Int — digits 120 == [1,2,0]; digits 0 == [0]", helperPrefix: "digits" },

  // --- Option / Result ------------------------------------------------------
  { name: "isSome", intent: "is an Option populated", deps: [], spec: "isSome : Option a -> Bool", helperPrefix: "isSome" },
  { name: "withDefault", intent: "unwrap an Option with a fallback", deps: [], spec: "withDefault : a -> Option a -> a", helperPrefix: "withDefault" },
  { name: "mapOption", intent: "map over an Option", deps: [], spec: "mapOption : (a -> b) -> Option a -> Option b", helperPrefix: "mapOption" },
  { name: "andThenOption", intent: "Option bind", deps: [], spec: "andThenOption : (a -> Option b) -> Option a -> Option b", helperPrefix: "andThenOption" },
  { name: "catOptions", intent: "keep the Somes", deps: [], spec: "catOptions : List (Option a) -> List a", helperPrefix: "catOptions" },
  { name: "Result", intent: "Result type: Ok a | Err e", deps: [], spec: "data Result e a = Err e | Ok a", helperPrefix: "result", test: false },
  { name: "mapResult", intent: "map over the Ok side", deps: ["Result"], spec: "mapResult : (a -> b) -> Result e a -> Result e b", helperPrefix: "mapResult" },
  { name: "withDefaultResult", intent: "unwrap a Result with a fallback", deps: ["Result"], spec: "withDefaultResult : a -> Result e a -> a", helperPrefix: "withDefaultResult" },
  { name: "andThenResult", intent: "Result bind", deps: ["Result"], spec: "andThenResult : (a -> Result e b) -> Result e a -> Result e b", helperPrefix: "andThenResult" },

  // --- binary search tree -> Set/Map --------------------------------------
  { name: "Tree", intent: "Int binary search tree type", deps: [], spec: "data Tree = Leaf | Node Tree Int Tree", helperPrefix: "tree", test: false },
  { name: "treeInsert", intent: "BST insert (no duplicates)", deps: ["Tree"], spec: "treeInsert : Int -> Tree -> Tree — inserting an existing key returns an equal tree", helperPrefix: "treeInsert" },
  { name: "treeMember", intent: "BST membership", deps: ["Tree"], spec: "treeMember : Int -> Tree -> Bool", helperPrefix: "treeMember" },
  { name: "treeFromList", intent: "build a BST from a list", deps: ["Tree", "treeInsert"], spec: "treeFromList : List Int -> Tree", helperPrefix: "treeFromList" },
  { name: "treeToList", intent: "in-order flatten (sorted, unique)", deps: ["Tree"], spec: "treeToList : Tree -> List Int — uses the prelude's append", helperPrefix: "treeToList" },
  { name: "treeSize", intent: "node count", deps: ["Tree"], spec: "treeSize : Tree -> Int", helperPrefix: "treeSize" },

  // --- queue ----------------------------------------------------------------
  { name: "Fifo", intent: "two-list FIFO queue of Ints", deps: [], spec: "data Fifo = Fifo (List Int) (List Int) — front list + reversed back list", helperPrefix: "fifo", test: false },
  { name: "fifoEmpty", intent: "the empty queue", deps: ["Fifo"], spec: "fifoEmpty : Fifo", helperPrefix: "fifoEmpty" },
  { name: "fifoPush", intent: "enqueue at the back", deps: ["Fifo"], spec: "fifoPush : Int -> Fifo -> Fifo", helperPrefix: "fifoPush" },
  { name: "fifoPop", intent: "dequeue from the front", deps: ["Fifo"], spec: "fifoPop : Fifo -> Option (Pair Int Fifo) — None on empty; amortized O(1) via reversal; helper fifoPopNorm", helperPrefix: "fifoPop" },

  // --- text (over the Text primitives) --------------------------------------
  { name: "textRepeat", intent: "concatenate n copies of a text", deps: [], spec: "textRepeat : Int -> Text -> Text — n <= 0 gives \"\"", helperPrefix: "textRepeat" },
  { name: "textJoin", intent: "join texts with a separator", deps: [], spec: "textJoin : Text -> List Text -> Text — textJoin \",\" [\"a\",\"b\"] == \"a,b\"; Nil gives \"\"", helperPrefix: "textJoin" },
  { name: "startsWith", intent: "prefix test", deps: [], spec: "startsWith : Text -> Text -> Bool — startsWith prefix s; empty prefix is true", helperPrefix: "startsWith" },
  { name: "endsWith", intent: "suffix test", deps: [], spec: "endsWith : Text -> Text -> Bool — endsWith suffix s; empty suffix is true", helperPrefix: "endsWith" },
  { name: "textContains", intent: "substring test", deps: ["startsWith"], spec: "textContains : Text -> Text -> Bool — textContains needle haystack; empty needle is true", helperPrefix: "textContains" },
  { name: "splitOn", intent: "split a text on a single-character separator", deps: [], spec: "splitOn : Text -> Text -> List Text — splitOn \",\" \"a,,b\" == [\"a\",\"\",\"b\"]; splitOn \",\" \"\" == [\"\"]", helperPrefix: "splitOn" },
  { name: "padLeft", intent: "left-pad with a single-char pad to a target width", deps: ["textRepeat"], spec: "padLeft : Int -> Text -> Text -> Text — padLeft 5 \"0\" \"42\" == \"00042\"; wide inputs unchanged", helperPrefix: "padLeft" },
];

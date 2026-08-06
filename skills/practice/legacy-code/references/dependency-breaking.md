# Dependency Breaking Techniques

From Working Effectively with Legacy Code (Michael Feathers). Use when code is hard to test because of hidden dependencies. Choose the technique that matches the actual barrier.

## Hidden Inputs

Dependencies the code reads but doesn't explicitly receive:

| Input | Symptom | Breaking Move |
|---|---|---|
| Current time | `datetime.now()`, `time.time()` | Inject a clock interface |
| Random values | `random.randint()`, `uuid4()` | Inject a random generator |
| Environment variables | `os.environ["X"]` | Inject a config object |
| Thread-local state | `threading.local()` | Pass state explicitly |
| Global singletons | `Config.instance()`, `get_db()` | Inject the dependency |
| Implicit current user/request | `get_current_user()` from global context | Pass user/request as parameter |

## Hard Outputs

Side effects the code produces but can't be observed or controlled:

| Output | Symptom | Breaking Move |
|---|---|---|
| File writes | `open(path, "w")` | Inject a filesystem interface |
| Network calls | `requests.post()`, `httpx.get()` | Inject an HTTP client |
| Database writes | `Model.objects.create()` | Inject a repository |
| Process exits | `sys.exit()`, `os._exit()` | Return a result, let caller decide |
| Message publication | `queue.publish()`, `channel.send()` | Inject a message bus |
| Control-flow logging | `logger.info()` used for logic | Separate logging from policy |

## Construction Problems

When you can't instantiate the class under test without pulling in the world:

| Problem | Symptom | Breaking Move |
|---|---|---|
| Constructor does I/O | DB queries, file reads, network calls in `__init__` | Move to factory/builder, inject result |
| Hidden `new` | `SomeService()` created inside a method | Extract factory method, inject factory |
| Buried factory | `get_service()` call deep in behavior | Inject the dependency instead |
| Object graph in logic | Complex construction interleaved with behavior | Split construction from use |

## Static and Global Reach-Through

| Problem | Breaking Move |
|---|---|
| Direct static method call | Wrap in an instance method, inject the wrapper |
| Global config access | Encapsulate behind an interface, inject the interface |
| Singleton access | Replace with constructor injection |

## Technique Index

Use the technique that matches the barrier:

| Technique | When to Use |
|---|---|
| **Adapt Parameter** | Method needs only a narrow view of a hard-to-create parameter |
| **Break Out Method Object** | Large method with local state that blocks extraction |
| **Definition Completion** | Missing definitions block tests, in languages that allow completing them in test code |
| **Encapsulate Global References** | Globals or singletons prevent substitution |
| **Expose Static Method** | Useful logic trapped behind instance setup |
| **Extract and Override Factory Method** | Construction of hard dependency must vary under test |
| **Extract Implementer / Extract Interface** | Concrete dependencies make substitution hard |
| **Introduce Instance Delegator** | Static behavior needs an instance seam |
| **Parameterize Constructor** | Hidden collaborators should become explicit constructor inputs |
| **Parameterize Method** | Hidden collaborators should become explicit method parameters |
| **Primitivize Parameter** | Real type is too costly to bring into the harness and primitive data is enough (unlike Adapt Parameter, passes raw data instead of a narrow view) |
| **Pull Up Feature / Push Down Dependency** | Behavior or a dependency should move to a more testable level in a class hierarchy |
| **Replace Global Reference with Getter** | Direct global access needs a seam |
| **Subclass and Override Method** | Safer composition seams not available (last resort) |
| **Supersede Instance Variable** | Test needs to replace a hard dependency held in a field |
| **Link / Preprocessing Seams** | Language/build constraints make ordinary object seams impractical (last resort) |
| **Template Redefinition** | Templated/generic code lets the test bind a substitute type at the link/instantiation seam (last resort) |
| **Text Redefinition** | Preprocessing or text substitution can redefine a symbol for the test build only (last resort) |

## Selection Heuristic

1. Can you inject the dependency through the constructor? → **Parameterize Constructor**
2. Can you inject it through a method parameter? → **Parameterize Method**
3. Is the dependency hidden behind a static/global? → **Encapsulate Global References** or **Introduce Instance Delegator**
4. Is construction the problem? → **Extract and Override Factory Method** or **Break Out Method Object**
5. Is the parameter too heavy to create? → **Adapt Parameter**
6. Nothing else works? → **Subclass and Override Method** or **Link Seam** (with cleanup obligation)

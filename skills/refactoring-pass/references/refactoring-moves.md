# Refactoring Moves

From Refactoring (Martin Fowler). Step-by-step instructions for specific refactoring techniques.

## Extract Method

**When:** A chunk of code has a distinct purpose.

1. Create a new method named after the intent (what it does, not how).
2. Copy the extracted code into the new method.
3. Replace the original code with a call to the new method.
4. Run tests.

```python
# Before
def print_owing(self):
    self.print_banner()
    
    # calculate outstanding
    outstanding = 0
    for order in self.orders:
        outstanding += order.amount
    
    # print details
    print(f"name: {self.name}")
    print(f"amount: {outstanding}")

# After
def print_owing(self):
    self.print_banner()
    outstanding = self._calculate_outstanding()
    self._print_details(outstanding)

def _calculate_outstanding(self):
    return sum(order.amount for order in self.orders)

def _print_details(self, outstanding):
    print(f"name: {self.name}")
    print(f"amount: {outstanding}")
```

## Inline Method

**When:** A method's body is as clear as its name. The indirection adds no value.

1. Replace every call to the method with its body.
2. Delete the method.
3. Run tests.

## Move Method

**When:** A method uses another class's data more than its class's own.

1. Create the method in the target class.
2. Copy the body, adjusting references to use the target class's data.
3. Replace the original with a delegation call (or delete if no longer needed).
4. Run tests.

## Rename

**When:** The name doesn't reveal intent. Do this first when bad names block understanding.

1. Rename the method/field/class.
2. Update all references.
3. Run tests.

## Introduce Parameter Object

**When:** A group of parameters always travels together.

1. Create a class to hold the parameter group.
2. Replace the parameter list with the new object.
3. Update callers to construct the object.
4. Run tests.

```python
# Before
def create_invoice(customer_name, customer_email, amount, currency, date):
    ...

# After
@dataclass
class InvoiceRequest:
    customer_name: str
    customer_email: str
    amount: Decimal
    currency: str
    date: date

def create_invoice(request: InvoiceRequest):
    ...
```

## Encapsulate Collection

**When:** Callers manipulate an internal collection directly.

1. Add methods for the operations callers perform (add, remove, count).
2. Make the internal collection private.
3. Replace direct manipulation with calls to the new methods.
4. Return a read-only copy or iterator instead of the raw collection.

## Decompose Conditional

**When:** A complex conditional is hard to read.

1. Extract the condition into a method named for what it checks.
2. Extract each branch into a method named for what it does.
3. Replace the conditional with calls to the extracted methods.

```python
# Before
if date.before(SUMMER_START) or date.after(SUMMER_END):
    charge = quantity * _winterRate + _winterServiceCharge
else:
    charge = quantity * _summerRate

# After
if _is_winter(date):
    charge = _winter_charge(quantity)
else:
    charge = _summer_charge(quantity)
```

## Replace Conditional with Polymorphism

**When:** Repeated type codes or switch statements that vary behavior.

1. Create a subclass for each type code value.
2. Move the behavior for each case into its subclass.
3. Replace the conditional with a polymorphic call.
4. Run tests.

## Use Guard Clauses

**When:** Nested conditionals with early exits.

1. Identify the early-exit conditions.
2. Invert each condition and return/raise at the top of the method.
3. The main logic is no longer nested.

```python
# Before
def get_pay_amount(self):
    if self.is_dead:
        return dead_amount()
    else:
        if self.is_separated:
            return separated_amount()
        else:
            if self.is_retired:
                return retired_amount()
            else:
                return normal_pay_amount()

# After
def get_pay_amount(self):
    if self.is_dead:
        return dead_amount()
    if self.is_separated:
        return separated_amount()
    if self.is_retired:
        return retired_amount()
    return normal_pay_amount()
```

## Extract Class

**When:** A class has two independent responsibilities.

1. Create a new class for the extracted responsibility.
2. Move relevant fields and methods to the new class.
3. Add a reference from the old class to the new class.
4. Update callers.
5. Run tests.

## Remove Middle Man

**When:** A class mostly just delegates to another class.

1. Remove the delegating methods.
2. Have callers call the delegate directly.
3. Run tests.

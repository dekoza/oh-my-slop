# When to Mock

Mock at **system boundaries** only:

- External APIs (payment, email, etc.).
- Databases (sometimes — prefer test DB).
- Time/randomness.
- File system (sometimes).

Don't mock:

- Your own classes/modules.
- Internal collaborators.
- Anything you control.

## Designing for Mockability

At system boundaries, design interfaces that are easy to mock:

**1. Use dependency injection**

Pass external dependencies in rather than creating them internally:

```python
# Easy to mock
def process_payment(order, payment_client):
    return payment_client.charge(order.total)

# Hard to mock
def process_payment(order):
    client = StripeClient(api_key=os.environ["STRIPE_KEY"])
    return client.charge(order.total)
```

**2. Prefer SDK-style interfaces over generic fetchers**

Create specific functions for each external operation instead of one generic function with conditional logic:

```python
# GOOD: Each function is independently mockable
class OrderAPI:
    def get_user(self, id: int) -> User: ...
    def get_orders(self, user_id: int) -> list[Order]: ...
    def create_order(self, data: dict) -> Order: ...

# BAD: Mocking requires conditional logic inside the mock
class GenericAPI:
    def fetch(self, endpoint: str, options: dict = ...) -> Response: ...
```

The SDK approach means:

- Each mock returns one specific shape.
- No conditional logic in test setup.
- Easier to see which endpoints a test exercises.
- Type safety per endpoint.

## Django-specific mocking

```python
# GOOD: httpx.MockTransport for HTTP client tests (AGENTS.md §9.3)
def test_webhook_sends_on_order_placed():
    responses = []
    def capture(request):
        responses.append(request)
        return httpx.Response(200)
    transport = httpx.MockTransport(capture)
    client = WebhookClient(httpx.Client(transport=transport))
    place_order(...)
    assert len(responses) == 1

# GOOD: Django mail.outbox for email tests (no mocking needed)
def test_order_confirmation_sends_email():
    place_order(user, cart)
    assert mail.outbox[0].to == [user.email]

# GOOD: override_settings for feature flags
@override_settings(FEATURE_CHECKOUT_V2=True)
def test_checkout_v2_is_active():
    assert get_checkout_version() == "v2"

# BAD: patching internal Django behaviour
@patch("django.db.models.Model.save")
def test_order_saves_to_db(mock_save):
    order.save()
    mock_save.assert_called_once()
```

## When real dependencies are better

Prefer real dependencies whenever possible:

- **Django's test client** (`self.client`) — real request/response cycle, no mocking.
- **Django's test database** — real SQL, real constraints, real indexes.
- **`mail.outbox`** — real email pipeline (in-memory), no mocking.
- **`settings.override`** — real settings override, no mocking.
- **`httpx.MockTransport`** — real HTTP client, mocked transport (closer to reality than `unittest.mock.patch`).

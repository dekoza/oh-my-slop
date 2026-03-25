---
domain: serializers-fields
category: reference
priority: high
---

# DRF Serializers, Fields, Relations & Validators Reference

Use when working with serializer classes, field types, relational fields, validators, or nested write operations.

### 1. Serializer Class Hierarchy

**The inheritance tree determines what you get for free and what you must write yourself.**

```
BaseSerializer
  └── Serializer (also a Field subclass)
        ├── ModelSerializer
        │     └── HyperlinkedModelSerializer
        └── ListSerializer
```

- `BaseSerializer` — override `to_representation` / `to_internal_value` for fully custom serialization
- `Serializer` — declarative field definitions, field-level and object-level validation
- `ModelSerializer` — auto-generates fields from model, auto-generates validators, provides default `.create()` / `.update()`
- `HyperlinkedModelSerializer` — uses `url` field instead of `pk`, relations use `HyperlinkedRelatedField`
- `ListSerializer` — auto-created when `many=True`; supports bulk create but NOT bulk update by default

**Warning:** `HyperlinkedModelSerializer` requires `request` in serializer context for absolute URLs. Manual instantiation without `context={'request': request}` produces relative URLs that break.

### 2. Serializer Constructor and Core API

**Every serializer interaction starts with instantiation — getting the arguments right prevents subtle bugs.**

```python
# Read (serialization)
serializer = MySerializer(instance)
serializer.data  # dict

# Write (deserialization)
serializer = MySerializer(data=request.data)
serializer.is_valid(raise_exception=True)  # always use raise_exception=True
serializer.save()  # calls .create()

# Update
serializer = MySerializer(instance, data=request.data)
serializer.is_valid(raise_exception=True)
serializer.save()  # calls .update()

# Partial update (PATCH)
serializer = MySerializer(instance, data=request.data, partial=True)

# Many objects
serializer = MySerializer(queryset, many=True)

# Extra context
serializer = MySerializer(instance, context={'request': request})
```

Key properties:
- `.data` — serialized output (read after `is_valid()` or with `instance`)
- `.validated_data` — deserialized input (available after `is_valid()`)
- `.errors` — dict of validation errors (available after `is_valid()`)
- `.initial_data` — raw input (available after passing `data=`)

**Warning:** `.save(**kwargs)` merges `kwargs` into `validated_data`. Use this to inject request-derived values: `serializer.save(owner=request.user)`. The kwargs are passed to `.create()` / `.update()`.

### 3. ModelSerializer Meta Options

**`Meta` controls auto-generation — misconfiguring it produces silent, hard-to-debug behavior.**

```python
class BookSerializer(serializers.ModelSerializer):
    class Meta:
        model = Book
        fields = ['id', 'title', 'author', 'price']  # explicit list (preferred)
        # fields = '__all__'                           # all model fields (avoid in production)
        # exclude = ['internal_notes']                 # mutually exclusive with fields
        read_only_fields = ['id', 'created_at']
        extra_kwargs = {
            'price': {'min_value': 0, 'required': True},
            'title': {'validators': [my_validator]},
        }
        depth = 0        # nested serialization depth (0 = FK as PK, 1 = one level deep)
        validators = []  # override auto-generated validators (e.g., UniqueTogetherValidator)
```

Auto-generation rules:
- `AutoField` → `read_only=True`
- `editable=False` → `read_only=True`
- `auto_now=True` / `auto_now_add=True` → `read_only=True`
- FK fields → `PrimaryKeyRelatedField`
- `unique_together` → auto `UniqueTogetherValidator`

**Warning:** `extra_kwargs` is **silently ignored** for fields explicitly declared on the serializer class. If you declare `title = serializers.CharField(...)` AND have `extra_kwargs = {'title': {...}}`, the extra_kwargs for `title` do nothing.

### 4. Field-Level and Object-Level Validation

**DRF validation runs entirely on the serializer — not split between form and model like Django forms.**

```python
class OrderSerializer(serializers.Serializer):
    quantity = serializers.IntegerField()
    price = serializers.DecimalField(max_digits=10, decimal_places=2)

    # Field-level: validate_<field_name>
    def validate_quantity(self, value):
        if value <= 0:
            raise serializers.ValidationError("Must be positive.")
        return value  # must return the value

    # Object-level: validate (receives full dict)
    def validate(self, data):
        if data['quantity'] * data['price'] > 10000:
            raise serializers.ValidationError("Order too large.")
        return data  # must return the dict
```

Validation order:
1. Field deserialization (`to_internal_value`) + field validators
2. `validate_<field_name>` methods
3. Object-level `validate()` method
4. Serializer-level validators (from `Meta.validators`)

Error structure:
- Field errors → keyed by field name: `{"quantity": ["Must be positive."]}`
- Object errors → keyed by `NON_FIELD_ERRORS_KEY` (default `"non_field_errors"`)

**Warning:** `validate_<field_name>` is **skipped** for `required=False` fields when the field is absent from input. Object-level `validate()` still runs.

### 5. Core Field Arguments

**These arguments apply to ALL field types — knowing them prevents repeated trips to the docs.**

| Argument | Default | Effect |
|---|---|---|
| `read_only` | `False` | Output only, ignored in input |
| `write_only` | `False` | Input only, excluded from output |
| `required` | `True` | Error if missing in input |
| `default` | - | Value when input absent; callable supported |
| `allow_null` | `False` | Accept `None` |
| `allow_blank` | `False` | Accept `""` (string fields only) |
| `source` | field name | Model attribute; dotted notation for traversal; `'*'` passes entire object |
| `validators` | `[]` | List of validator callables |
| `error_messages` | `{}` | Override error code → message mapping |

**Warning:** `source='user.email'` (dotted notation) traverses relationships but causes N+1 queries. Always pair with `select_related()` / `prefetch_related()` on the view's queryset.

### 6. String, Numeric, and Boolean Fields

**Field choice determines validation behavior — using the wrong field type produces confusing errors.**

| Field | Key Args | Maps to Model Field |
|---|---|---|
| `CharField` | `max_length, min_length, allow_blank, trim_whitespace=True` | `CharField` / `TextField` |
| `EmailField` | `max_length, min_length, allow_blank` | `EmailField` |
| `RegexField` | `regex, max_length, min_length` | - |
| `SlugField` | `max_length=50, allow_blank` | `SlugField` |
| `URLField` | `max_length=200, allow_blank` | `URLField` |
| `UUIDField` | `format='hex_verbose'` | `UUIDField` |
| `IPAddressField` | `protocol='both'` | `GenericIPAddressField` |
| `IntegerField` | `max_value, min_value` | `IntegerField` |
| `FloatField` | `max_value, min_value` | `FloatField` |
| `DecimalField` | `max_digits, decimal_places, coerce_to_string, max_value, min_value` | `DecimalField` |
| `BooleanField` | - | `BooleanField` |
| `NullBooleanField` | - | `NullBooleanField` (deprecated — use `BooleanField(allow_null=True)`) |

**Warning:** `allow_blank=True` + `allow_null=True` on `CharField` creates two empty representations (`""` and `null`). Avoid — pick one.

### 7. Date/Time, Choice, File, and Composite Fields

**Date format configuration is global by default — per-field overrides require explicit `format` arg.**

| Field | Key Args | Default Format |
|---|---|---|
| `DateTimeField` | `format=DATETIME_FORMAT, input_formats, default_timezone` | `'iso-8601'` |
| `DateField` | `format=DATE_FORMAT, input_formats` | `'iso-8601'` |
| `TimeField` | `format=TIME_FORMAT, input_formats` | `'iso-8601'` |
| `DurationField` | `max_value, min_value` | `'django'` format |
| `ChoiceField` | `choices, allow_blank=False` | - |
| `MultipleChoiceField` | `choices, allow_blank=False` | returns deduplicated `list` |
| `FileField` | `max_length, allow_empty_file, use_url=True` | requires `MultiPartParser` |
| `ImageField` | same as FileField | requires `Pillow` |
| `ListField` | `child=<Field>, allow_empty=True, min_length, max_length` | - |
| `DictField` | `child=<Field>, allow_empty=True` | keys always strings |
| `JSONField` | `binary=False, encoder=None` | - |

Special-purpose fields:
- `ReadOnlyField()` — returns value unmodified; auto-used for model properties/methods
- `HiddenField(default=...)` — not in user input, always uses default
- `SerializerMethodField()` — read-only; calls `get_<field_name>(self, obj)` method

**Warning:** `HiddenField` is NOT present in `partial=True` (PATCH) requests. If your `.update()` logic depends on a `HiddenField` value, it will be missing during PATCH.

### 8. Relational Fields

**Relational fields control how related objects appear in API output — choosing wrong causes N+1 or broken writes.**

| Field | Read/Write | Key Args |
|---|---|---|
| `PrimaryKeyRelatedField` | R/W | `queryset` (required for writes), `many`, `allow_null`, `pk_field` |
| `StringRelatedField` | Read-only | `many` — uses model's `__str__()` |
| `SlugRelatedField` | R/W | `slug_field` (required), `queryset`, `many` — slug should be `unique=True` |
| `HyperlinkedRelatedField` | R/W | `view_name` (required), `queryset`, `many`, `lookup_field='pk'` |
| `HyperlinkedIdentityField` | Read-only | `view_name` (required), `lookup_field='pk'` |

Rules:
- `queryset` is required for **writable** relational fields (not needed if `read_only=True`)
- **Reverse relations** are NOT auto-included in `ModelSerializer` — must explicitly add to `fields`
- **M2M with through model** → auto set to `read_only`; serialize the through model as nested object instead
- Generic FK → requires custom `RelatedField` subclass

Custom relational field pattern:
```python
class TrackSerializer(serializers.RelatedField):
    def to_representation(self, value):
        return f'{value.name} ({value.duration})'

    def to_internal_value(self, data):  # for writes
        try:
            return Track.objects.get(name=data)
        except Track.DoesNotExist:
            raise serializers.ValidationError("Track not found.")
```

**Warning:** HTML select dropdowns cut off at 1000 items by default (`HTML_SELECT_CUTOFF`). For large related sets, use autocomplete widgets or text input instead.

### 9. Writable Nested Serializers

**This is the single most common DRF pain point. ModelSerializer never handles nested writes — you always implement them manually.**

```python
class TrackSerializer(serializers.ModelSerializer):
    class Meta:
        model = Track
        fields = ['id', 'title', 'duration']

class AlbumSerializer(serializers.ModelSerializer):
    tracks = TrackSerializer(many=True)

    class Meta:
        model = Album
        fields = ['id', 'album_name', 'artist', 'tracks']

    def create(self, validated_data):
        tracks_data = validated_data.pop('tracks')
        album = Album.objects.create(**validated_data)
        for track_data in tracks_data:
            Track.objects.create(album=album, **track_data)
        return album

    def update(self, instance, validated_data):
        tracks_data = validated_data.pop('tracks', None)
        instance.album_name = validated_data.get('album_name', instance.album_name)
        instance.artist = validated_data.get('artist', instance.artist)
        instance.save()

        if tracks_data is not None:
            instance.tracks.all().delete()  # or merge strategy
            for track_data in tracks_data:
                Track.objects.create(album=instance, **track_data)
        return instance
```

**Warning:** The update strategy (delete-and-recreate vs. merge) is a business decision. Delete-and-recreate is simpler but destroys PKs. Merge requires matching by ID and handling creates/updates/deletes separately.

### 10. Built-in Validators

**Validators handle uniqueness constraints that the model would normally enforce at the DB level.**

| Validator | Applied To | Key Args |
|---|---|---|
| `UniqueValidator` | Field | `queryset` (required), `message`, `lookup='exact'` |
| `UniqueTogetherValidator` | Serializer `Meta.validators` | `queryset` (required), `fields` (required) |
| `UniqueForDateValidator` | Serializer `Meta.validators` | `queryset`, `field`, `date_field` |
| `UniqueForMonthValidator` | Serializer `Meta.validators` | `queryset`, `field`, `date_field` |
| `UniqueForYearValidator` | Serializer `Meta.validators` | `queryset`, `field`, `date_field` |

Advanced defaults:
- `CurrentUserDefault` — returns `request.user` from context (use with `HiddenField`)
- `CreateOnlyDefault(default)` — applies default only on create, omitted on update

```python
class ArticleSerializer(serializers.ModelSerializer):
    author = serializers.HiddenField(default=serializers.CurrentUserDefault())

    class Meta:
        model = Article
        fields = ['id', 'title', 'body', 'author']
```

**Warning:** `UniqueTogetherValidator` makes all its fields implicitly `required=True`. For optional fields in unique constraints, handle validation in `.validate()` instead and set `Meta.validators = []` to disable auto-generated validators.

### 11. Custom Fields

**Subclass `Field` for type coercion that no built-in field handles.**

```python
class ColorField(serializers.Field):
    def to_representation(self, value):
        return f'#{value.r:02x}{value.g:02x}{value.b:02x}'

    def to_internal_value(self, data):
        if not isinstance(data, str) or not data.startswith('#') or len(data) != 7:
            self.fail('invalid')
        try:
            return Color(int(data[1:3], 16), int(data[3:5], 16), int(data[5:7], 16))
        except ValueError:
            self.fail('invalid')

    default_error_messages = {
        'invalid': 'Not a valid color hex string.',
    }
```

Override `get_attribute(self, instance)` to change how the value is extracted from the model instance. Override `get_value(self, dictionary)` to change how input is extracted from request data.

**Warning:** Use `self.fail(key)` to raise errors from `default_error_messages` — this ensures error codes are consistent and translatable.

### 12. Dynamic Field Modification

**Override `__init__` to modify fields at runtime — the cleanest approach for conditional field sets.**

```python
class DynamicFieldsSerializer(serializers.ModelSerializer):
    def __init__(self, *args, **kwargs):
        fields = kwargs.pop('fields', None)
        super().__init__(*args, **kwargs)

        if fields is not None:
            allowed = set(fields)
            existing = set(self.fields)
            for field_name in existing - allowed:
                self.fields.pop(field_name)
```

Use `self.context` to access request/view for permission-based field filtering:
```python
def __init__(self, *args, **kwargs):
    super().__init__(*args, **kwargs)
    request = self.context.get('request')
    if request and not request.user.is_staff:
        self.fields.pop('internal_notes', None)
```

**Warning:** Do not modify `self.fields` outside `__init__` — the field set should be stable after construction.

### 13. ListSerializer and Bulk Operations

**`many=True` creates a `ListSerializer` wrapper. Bulk create works by default; bulk update does not.**

```python
# Default: bulk create works
serializer = BookSerializer(data=book_list, many=True)
serializer.is_valid(raise_exception=True)
serializer.save()  # calls child .create() for each item

# Bulk update: requires custom ListSerializer
class BookListSerializer(serializers.ListSerializer):
    def update(self, instance, validated_data):
        book_mapping = {book.id: book for book in instance}
        data_mapping = {item['id']: item for item in validated_data}

        result = []
        for book_id, data in data_mapping.items():
            book = book_mapping.get(book_id)
            if book:
                result.append(self.child.update(book, data))
            else:
                result.append(self.child.create(data))
        return result

class BookSerializer(serializers.ModelSerializer):
    class Meta:
        model = Book
        fields = ['id', 'title', 'author']
        list_serializer_class = BookListSerializer
```

**Warning:** Default `ListSerializer` validates each item independently — cross-item validation (e.g., "no duplicate titles in the batch") requires overriding `validate()` on the `ListSerializer`.

### 14. ModelSerializer Field Mapping Internals

**When auto-generated field types are wrong, override the mapping methods — not the fields themselves.**

Key customization methods:
- `build_standard_field(field_name, model_field)` → `(field_class, field_kwargs)`
- `build_relational_field(field_name, relation_info)` → `(field_class, field_kwargs)`
- `build_nested_field(field_name, relation_info, nested_depth)` → `(field_class, field_kwargs)`
- `build_property_field(field_name, model_class)` → returns `ReadOnlyField`
- `build_url_field(field_name, model_class)` → returns `HyperlinkedIdentityField`

Class-level overrides:
- `serializer_field_mapping` — dict mapping Django model fields to serializer field classes
- `serializer_related_field` — default `PrimaryKeyRelatedField`
- `serializer_choice_field` — default `ChoiceField`

Debug auto-generated fields: `python manage.py shell` → `print(repr(MySerializer()))`

**Warning:** `relation_info` is a named tuple with `model_field`, `related_model`, `to_many`, `has_through_model`. Check `has_through_model` before allowing writes on M2M fields.

### 15. Serializer Context Propagation

**Context flows from view to serializer to nested serializers — breaking this chain causes `request` to be unavailable in nested code.**

`GenericAPIView.get_serializer()` auto-provides `context={'request': request, 'view': self, 'format': self.format_kwarg}`.

Access in serializer methods:
```python
def validate(self, data):
    request = self.context['request']
    # ...
```

**Warning:** Manual serializer instantiation (outside a generic view) requires explicit context passing. `MySerializer(data=data, context={'request': request})`. Without this, `HyperlinkedRelatedField`, `CurrentUserDefault`, and any code accessing `self.context['request']` will fail.

# WordWise API Documentation

## Base URL

```
http://localhost:8000
```

## Authentication

Most endpoints require authentication using JWT tokens. Include the token in the Authorization header:

```
Authorization: Bearer <your_token>
```

## Endpoints

### Authentication

#### Register User

```http
POST /auth/register
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "username": "johndoe",
  "password": "password123",
  "language_preference": "en",
  "proficiency_level": "A1"
}
```

**Response:** `201 Created`
```json
{
  "id": 1,
  "email": "user@example.com",
  "username": "johndoe",
  "language_preference": "en",
  "proficiency_level": "A1",
  "is_active": true,
  "created_at": "2024-01-01T00:00:00Z"
}
```

#### Login

```http
POST /auth/login
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:** `200 OK`
```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "token_type": "bearer"
}
```

#### Get Current User

```http
GET /auth/me
```

**Headers:**
```
Authorization: Bearer <token>
```

**Response:** `200 OK`
```json
{
  "id": 1,
  "email": "user@example.com",
  "username": "johndoe",
  "language_preference": "en",
  "proficiency_level": "A1",
  "is_active": true,
  "created_at": "2024-01-01T00:00:00Z"
}
```

### Movies

#### List Movies

```http
GET /movies/
```

**Query Parameters:**
- `skip` (integer, default: 0): Number of records to skip
- `limit` (integer, default: 10, max: 100): Number of records to return
- `difficulty` (string, optional): Filter by difficulty level (A1, A2, B1, B2, C1, C2)

**Response:** `200 OK`
```json
{
  "movies": [
    {
      "id": 1,
      "title": "The Matrix",
      "year": 1999,
      "genre": "Sci-Fi",
      "difficulty_level": "B2",
      "word_count": 5000,
      "description": "A computer hacker learns from mysterious rebels...",
      "poster_url": "https://example.com/poster.jpg",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "page_size": 10
}
```

#### Get Movie

```http
GET /movies/{movie_id}
```

**Response:** `200 OK`
```json
{
  "id": 1,
  "title": "The Matrix",
  "year": 1999,
  "genre": "Sci-Fi",
  "difficulty_level": "B2",
  "word_count": 5000,
  "description": "A computer hacker learns from mysterious rebels...",
  "poster_url": "https://example.com/poster.jpg",
  "created_at": "2024-01-01T00:00:00Z"
}
```

#### Create Movie

```http
POST /movies/
```

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "title": "The Matrix",
  "year": 1999,
  "genre": "Sci-Fi",
  "difficulty_level": "B2",
  "script_text": "Full movie script text...",
  "description": "A computer hacker learns from mysterious rebels...",
  "poster_url": "https://example.com/poster.jpg"
}
```

**Response:** `201 Created`
```json
{
  "id": 1,
  "title": "The Matrix",
  "year": 1999,
  "genre": "Sci-Fi",
  "difficulty_level": "B2",
  "word_count": 0,
  "description": "A computer hacker learns from mysterious rebels...",
  "poster_url": "https://example.com/poster.jpg",
  "created_at": "2024-01-01T00:00:00Z"
}
```

### User Word Lists

#### Get User's Words

```http
GET /users/me/words
```

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
- `list_type` (string, optional): Filter by list type (learn_later, favorites, mastered)

**Response:** `200 OK`
```json
[
  {
    "id": 1,
    "user_id": 1,
    "word_id": 5,
    "list_type": "favorites",
    "added_at": "2024-01-01T00:00:00Z"
  }
]
```

#### Add Word to List

```http
POST /users/words
```

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "word_id": 5,
  "list_type": "favorites"
}
```

**Response:** `201 Created`
```json
{
  "id": 1,
  "user_id": 1,
  "word_id": 5,
  "list_type": "favorites",
  "added_at": "2024-01-01T00:00:00Z"
}
```

#### Remove Word from List

```http
DELETE /users/words/{word_list_id}
```

**Headers:**
```
Authorization: Bearer <token>
```

**Response:** `204 No Content`

## Error Responses

### 400 Bad Request

```json
{
  "detail": "Email already registered"
}
```

### 401 Unauthorized

```json
{
  "detail": "Could not validate credentials"
}
```

### 404 Not Found

```json
{
  "detail": "Movie not found"
}
```

## Rate Limiting

API rate limits may be implemented in the future. Current limits:
- 100 requests per minute per IP
- 1000 requests per hour per user

## Pagination

List endpoints support pagination using `skip` and `limit` parameters:

```
GET /movies/?skip=0&limit=10
```

## Filtering

Some endpoints support filtering:

```
GET /movies/?difficulty=B2
GET /users/me/words?list_type=favorites
```

## Sorting

Sorting may be added in future versions.

## Interactive API Documentation

Visit http://localhost:8000/docs for interactive API documentation powered by Swagger UI.

Visit http://localhost:8000/redoc for alternative API documentation powered by ReDoc.



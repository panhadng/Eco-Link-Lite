# Neo4j Queries to Delete User by Email

## Step 1: Find the email (case-insensitive search)

```cypher
MATCH (email:EmailAddress)
WHERE toLower(email.email) = toLower('brian@flyonit.com.au')
RETURN email.email as emailAddress, email
```

Or find all emails matching that pattern:
```cypher
MATCH (email:EmailAddress)
WHERE email.email CONTAINS 'brian@flyonit'
RETURN email.email as emailAddress, email
```

## Step 2: Find the user connected to that email

```cypher
MATCH (email:EmailAddress)
WHERE toLower(email.email) = toLower('brian@flyonit.com.au')
OPTIONAL MATCH (email)-[:BELONGS_TO]->(user:User)
OPTIONAL MATCH (user)-[:PRIMARY_EMAIL]->(email)
RETURN email.email as email, user.id as userId, user.name as userName, user.slug as userSlug
```

## Step 3: Delete the user and email (complete deletion)

```cypher
MATCH (email:EmailAddress)
WHERE toLower(email.email) = toLower('brian@flyonit.com.au')
OPTIONAL MATCH (email)-[:BELONGS_TO]->(user:User)
OPTIONAL MATCH (user)-[r1]-()
OPTIONAL MATCH (email)-[r2]-()
DETACH DELETE user, email
RETURN count(user) as deletedUsers, count(email) as deletedEmails
```

## Alternative: More thorough deletion (if above doesn't work)

```cypher
MATCH (email:EmailAddress)
WHERE toLower(email.email) = toLower('brian@flyonit.com.au')
MATCH (email)-[:BELONGS_TO]->(user:User)
WITH user, email
OPTIONAL MATCH (user)-[r1]-()
OPTIONAL MATCH (email)-[r2]-()
DETACH DELETE r1, r2, user, email
```

## If user doesn't exist yet (only EmailAddress exists):

```cypher
MATCH (email:EmailAddress)
WHERE toLower(email.email) = toLower('brian@flyonit.com.au')
OPTIONAL MATCH (email)-[r]-()
DETACH DELETE email, r
```

## List all users and their emails (to find the right one):

```cypher
MATCH (user:User)-[:PRIMARY_EMAIL]->(email:EmailAddress)
RETURN user.id, user.name, user.slug, email.email
ORDER BY user.createdAt DESC
LIMIT 20
```


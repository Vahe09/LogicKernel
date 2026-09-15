-- Public teaching fixture. Create a NEW temporary database for every submission.
CREATE TABLE courses (id INTEGER PRIMARY KEY, title TEXT NOT NULL);
CREATE TABLE students (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  city TEXT,
  course_id INTEGER NOT NULL REFERENCES courses(id)
);
INSERT INTO courses (id, title) VALUES (1, 'Python'), (2, 'Go');
INSERT INTO students (id, name, score, city, course_id) VALUES
  (1, 'Аня', 80, 'Ереван', 1),
  (2, 'Борис', 60, NULL, 1),
  (3, 'Вера', 95, 'Москва', 2);

// Runs before any module import in tests, so config.ts sees these values.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://postgres@localhost:5432/classes_test';
process.env.JWT_SECRET ??= 'test-secret-that-is-long-enough-for-validation-1234';
// Keep test uploads out of the project folder.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.UPLOAD_DIR ??= join(tmpdir(), 'mainstay-classes-test-uploads');

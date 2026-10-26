import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('health', () => {
  it('GET /v1/health', async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = configureApp(mod.createNestApplication());
    await app.init();
    const res = await request(app.getHttpServer()).get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    await app.close();
  });
});

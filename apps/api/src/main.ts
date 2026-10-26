import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

async function main() {
  const app = configureApp(await NestFactory.create(AppModule, { bodyParser: false }));
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`AriForce API on http://localhost:${port}`);
}

void main();

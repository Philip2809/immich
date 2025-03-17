import { DatabaseExtension } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { createVectorIndex } from 'src/repositories/database.repository';
import { MigrationInterface, QueryRunner } from 'typeorm';

const vectorExtension = new ConfigRepository().getEnv().database.vectorExtension;

export class AddCLIPEmbeddingIndex1700713994428 implements MigrationInterface {
  name = 'AddCLIPEmbeddingIndex1700713994428';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (vectorExtension === DatabaseExtension.VECTORS) {
      await queryRunner.query(`SET vectors.pgvector_compatibility=on`);
    }
    await queryRunner.query(`SET search_path TO "$user", public, vectors`);

    await queryRunner.query(createVectorIndex(vectorExtension, 'smart_search', 'clip_index'));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS clip_index`);
  }
}

import {
  Entity, PrimaryGeneratedColumn, Column,
  ManyToOne, JoinColumn, CreateDateColumn, RelationId,
} from 'typeorm';
import { Product } from './product.entity';

@Entity('product_variants')
export class ProductVariant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Product, (p) => p.variants, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @RelationId((v: ProductVariant) => v.product)
  product_id: string;

  @Column({ unique: true, length: 100 })
  sku_code: string;

  @Column({ type: 'varchar', nullable: true, length: 20 })
  size: string | null;

  @Column({ type: 'varchar', nullable: true, length: 50 })
  color: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @Column({ default: 0 })
  stock: number;

  @CreateDateColumn()
  created_at: Date;
}

import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('product_metrics')
export class ProductMetrics {
  @PrimaryColumn('uuid')
  product_id: string;

  @Column({ type: 'int', default: 0 })
  views_count: number;

  @Column({ type: 'int', default: 0 })
  clicks_count: number;

  @Column({ type: 'int', default: 0 })
  cart_adds_count: number;

  @Column({ type: 'int', default: 0 })
  purchases_count: number;

  @UpdateDateColumn()
  updated_at: Date;
}

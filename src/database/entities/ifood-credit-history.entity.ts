import { ObjectId } from 'mongodb';
2
+import { Column, Entity, ObjectIdColumn } from 'typeorm';
3
+
4
+export type IfoodCreditOperationType = 'ADD' | 'REMOVE' | 'CONSUME';
5
+
6
+@Entity()
7
+export class IfoodCreditHistoryEntity {
8
+  @ObjectIdColumn()
9
+  internalId: ObjectId;
10
+
11
+  @Column('uuid')
12
+  id: string;
13
+
14
+  @Column()
15
+  companyId: string;
16
+
17
+  @Column()
18
+  operationType: IfoodCreditOperationType;
19
+
20
+  @Column()
21
+  amount: number;
22
+
23
+  @Column()
24
+  releasedAfterOperation: number;
25
+
26
+  @Column()
27
+  usedAfterOperation: number;
28
+
29
+  @Column()
30
+  availableAfterOperation: number;
31
+
32
+  @Column({ nullable: true })
33
+  performedBy?: string;
34
+
35
+  @Column({ nullable: true })
36
+  orderId?: string;
37
+
38
+  @Column({ nullable: true })
39
+  reason?: string;
40
+
41
+  @Column()
42
+  createdAt: Date;
+
43
+}
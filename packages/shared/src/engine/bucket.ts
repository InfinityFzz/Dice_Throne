/**
 * 伤害分桶与 flush —— 架构 §2.4.4（P6 SIMULTANEOUS）。
 *
 * 铁律：伤害类 effect 不直接改 HP，只写 bucket；HP 只在 flush 时被写一次。
 * 这是「同时结算」从口头约定变成代码不变量的关键。
 */
import { BUCKET_OF, type BucketKind, type DamageType, type DamageSourceKind, type Seat } from '../types/core.js';
import type { BucketEntry, DamageBucket } from '../types/state.js';

export interface FlushResult {
  readonly net: number;
  /** 未 clamp 的 HP 值，死亡判定用它 */
  readonly hpRaw: number;
  /** 实际写入的 HP（已 clamp 上限） */
  readonly hpAfter: number;
  readonly defeated: boolean;
  /** 计入「造成的伤害」的量（damageDealtAtLeast 用） */
  readonly damageDealt: number;
}

/**
 * 「造成的伤害」判定 —— 由正交轴决定，与 DamageType 无关。
 * 防御反伤（sourceKind:'ability'，target=攻击者）计入；
 * 自我反噬（sourceKind:'recoil'）不计入。
 */
export function countsAsDamageDealt(e: BucketEntry): boolean {
  return e.toSeat !== e.fromSeat && e.sourceKind !== 'recoil';
}

export function bucketKindOf(damageType: DamageType): BucketKind {
  return BUCKET_OF[damageType];
}

export function addDamage(
  bucket: DamageBucket,
  amount: number,
  damageType: DamageType,
  toSeat: Seat,
  fromSeat: Seat,
  sourceKind: DamageSourceKind = 'ability',
): DamageBucket {
  if (amount <= 0) return bucket;
  return {
    ...bucket,
    entries: [...bucket.entries, {
      bucketKind: bucketKindOf(damageType),
      amount,
      damageType,
      sourceKind,
      toSeat,
      fromSeat,
    }],
  };
}

export function addHeal(bucket: DamageBucket, toSeat: Seat, amount: number): DamageBucket {
  if (amount <= 0) return bucket;
  return { ...bucket, heals: [...bucket.heals, { toSeat, amount }] };
}

export function addAvoid(bucket: DamageBucket, toSeat: Seat): DamageBucket {
  return { ...bucket, avoid: [...bucket.avoid, { toSeat }] };
}

export function addPrevention(bucket: DamageBucket, toSeat: Seat, amount: number): DamageBucket {
  if (amount <= 0) return bucket;
  return {
    ...bucket,
    entries: [...bucket.entries, {
      bucketKind: 'prevention' as BucketKind,
      amount,
      toSeat,
      fromSeat: toSeat,
    }],
  };
}

/** 对单个 seat 求值 flush（每个 seat 各算一遍） */
export function flushForSeat(bucket: DamageBucket, seat: Seat, hp: number, startHp: number): FlushResult {
  const mine = bucket.entries.filter((e) => e.toSeat === seat);
  const avoided = bucket.avoid.some((a) => a.toSeat === seat);

  const sum = (kind: BucketKind): number =>
    mine.filter((e) => e.bucketKind === kind).reduce((acc, e) => acc + e.amount, 0);

  // C7：avoid 只清 defendable + collateral，不作用于 undefendable / pure
  const rawDefendable = sum('defendable');
  const rawCollateral = sum('collateral');
  const rawUndefendable = sum('undefendable');
  const prevention = sum('prevention');

  const defendable = avoided ? 0 : rawDefendable;
  const collateral = avoided ? 0 : rawCollateral;

  // 减伤只吃可防御部分，不会溢出成治疗
  const netDefendable = Math.max(0, defendable - prevention);
  const net = netDefendable + rawUndefendable + collateral;

  const healing = bucket.heals
    .filter((h) => h.toSeat === seat)
    .reduce((acc, h) => acc + h.amount, 0);

  // C5：净额结算，治疗可以救回死亡
  const hpRaw = hp - net + healing;
  const hpAfter = hpRaw <= 0 ? hpRaw : Math.min(startHp + 10, hpRaw);

  const damageDealt = mine
    .filter((e) => e.bucketKind !== 'prevention')
    .filter(countsAsDamageDealt)
    .reduce((acc, e) => acc + (e.bucketKind === 'defendable' ? 0 : e.amount), 0);

  return { net, hpRaw, hpAfter, defeated: hpRaw <= 0, damageDealt };
}

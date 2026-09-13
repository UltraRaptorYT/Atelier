export const limits = { globalDesktops: 2, userDailySeconds: 3600, globalMonthlySeconds: 720000, monthlyDollars: 35, costPerSecond: .000046, leaseSeconds: 900 } as const;
export type Usage = { active: number; dailySeconds: number; monthlySeconds: number };
export function admission(usage: Usage, seconds: number, dailyLimit: number = limits.userDailySeconds): string | null {
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > limits.leaseSeconds) return 'Invalid computer reservation.';
  if (!Number.isInteger(dailyLimit) || dailyLimit < limits.userDailySeconds || dailyLimit > limits.userDailySeconds + 1800) return 'Invalid daily computer allowance.';
  if (usage.active >= limits.globalDesktops) return 'queue';
  if (usage.dailySeconds + seconds > dailyLimit) return 'Your daily computer allowance has been reached.';
  if (usage.monthlySeconds + seconds > limits.globalMonthlySeconds || (usage.monthlySeconds + seconds) * limits.costPerSecond > limits.monthlyDollars) return 'The studio’s monthly computer allowance has been reached.';
  return null;
}

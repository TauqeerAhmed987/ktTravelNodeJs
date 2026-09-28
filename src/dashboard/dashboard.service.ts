import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

interface MonthlyRow {
  month: string;
  total: bigint | number;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  // Mirrors the old MainController@Dashboard "else" branch (role 1/admin —
  // sees everything, no client_created_by scoping).
  async getStats() {
    const [counthotels, countclient, countevent] = await Promise.all([
      this.prisma.hotels.count({ where: { hotel_status: 'active' } }),
      this.prisma.users.count({ where: { status: 'active', role: 3 } }),
      this.prisma.events.count(),
    ]);

    const [clientsPerMonth, hotelsPerMonth, eventsPerMonth] = await Promise.all([
      this.prisma.$queryRaw<MonthlyRow[]>`
        SELECT CONCAT(DATE_FORMAT(created_at, '%b'), '''', DATE_FORMAT(created_at, '%y')) as month, COUNT(*) as total
        FROM users WHERE status = 'active' AND role = 3
        GROUP BY month ORDER BY MIN(created_at)
      `,
      this.prisma.$queryRaw<MonthlyRow[]>`
        SELECT CONCAT(DATE_FORMAT(created_at, '%b'), '''', DATE_FORMAT(created_at, '%y')) as month, COUNT(*) as total
        FROM hotels WHERE hotel_status = 'active'
        GROUP BY month ORDER BY MIN(created_at)
      `,
      this.prisma.$queryRaw<MonthlyRow[]>`
        SELECT CONCAT(DATE_FORMAT(created_at, '%b'), '''', DATE_FORMAT(created_at, '%y')) as month, COUNT(*) as total
        FROM events
        GROUP BY month ORDER BY MIN(created_at)
      `,
    ]);

    const toSeries = (rows: MonthlyRow[]) => ({
      categories: rows.map((r) => r.month),
      data: rows.map((r) => Number(r.total)),
    });

    const clients = toSeries(clientsPerMonth);
    const hotels = toSeries(hotelsPerMonth);
    const events = toSeries(eventsPerMonth);

    return {
      counthotels,
      countclient,
      countevent,
      categories: clients.categories,
      datas: clients.data,
      hotelCategories: hotels.categories,
      hotelDatas: hotels.data,
      revenueChartCategories: events.categories,
      revenueChartData: events.data,
    };
  }
}

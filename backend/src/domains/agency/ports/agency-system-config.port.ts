export interface AgencySystemConfigPort {
  getNumber(key: string, defaultValue: number): Promise<number>;
}

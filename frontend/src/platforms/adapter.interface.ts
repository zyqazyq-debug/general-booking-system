export interface AuthData {
  user: any;
  platform_token?: string;
}

export interface PlatformAdapter {
  name: string;
  
  // 核心能力检测
  isCurrentRuntime(): boolean;
  
  // 认证相关
  login(): Promise<AuthData | null>;
  
  // 交互相关
  share(options?: any): void;
  pay(options?: any): Promise<void>;
  
  // 界面相关
  setNavigationBarTitle(title: string): void;
  setNavigationBarColor(options: any): void;
}

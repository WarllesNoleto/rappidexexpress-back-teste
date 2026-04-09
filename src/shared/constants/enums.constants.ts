export enum UserType {
  SHOPKEEPER = 'shopkeeper',
  MOTOBOY = 'motoboy',
  ADMIN = 'admin',
  SHOPKEEPERADMIN = 'shopkeeperadmin',
  SUPERADMIN = 'superadmin',
}

export enum Permissions {
  MASTER = 'master',
  ADMIN = 'admin',
  USER = 'none',
  SUPERADMIN = 'superadmin',

}

export enum StatusDelivery {
  PENDING = 'PENDENTE',
  ONCOURSE = 'ACAMINHO',
  COLLECTED = 'COLETADO',
  FINISHED = 'FINALIZADO',
  CANCELED = 'CANCELADO',
}

export enum PaymentType {
  CARTAO = 'CARTAO',
  PAGO = 'PAGO',
  PIX = 'PIX',
  DINHEIRO = 'DINHEIRO',
}

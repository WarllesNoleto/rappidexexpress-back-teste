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
  AWAITING_RELEASE = 'AGUARDANDO_LIBERACAO',
  PENDING = 'PENDENTE',
  ONCOURSE = 'ACAMINHO',
  ARRIVED_AT_STORE = 'CHEGOU_ESTABELECIMENTO',
  COLLECTED = 'COLETADO',
  ARRIVED_AT_DESTINATION = 'CHEGOU_DESTINO',
  AWAITING_CODE = 'AGUARDANDO_CODIGO',
  FINISHED = 'FINALIZADO',
  CANCELED = 'CANCELADO',
}

export enum PaymentType {
  CARTAO = 'CARTAO',
  PAGO = 'PAGO',
  PIX = 'PIX',
  DINHEIRO = 'DINHEIRO',
}

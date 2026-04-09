import { createParamDecorator } from '@nestjs/common';

export const User = createParamDecorator((data, ctx) => {
  const req = ctx.switchToHttp().getRequest();
  return req.user;
});
